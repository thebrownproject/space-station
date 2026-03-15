# Spec 04: Scheduler Daemon

## Summary

A long-running Node.js process (`spacestation daemon`) that reads `cron.yaml` files from agent folders and spawns Claude Code sessions at scheduled times. Uses `croner` for scheduling. Manages concurrency, catch-up for missed runs, and execution logging.

## Files to Create

```
src/scheduler/
  daemon.ts              # Main daemon process
  scheduler.ts           # CronManager (scheduling logic)
  runner.ts              # Claude Code session spawner
  scheduler-types.ts     # Type definitions
  index.ts               # Public exports
  __tests__/
    scheduler.test.ts

src/cli/commands/
  daemon.ts              # spacestation daemon start/stop/status
  run.ts                 # spacestation run <agent> (manual trigger)
```

## New Dependencies

```
croner (^10.0.0)         — Cron scheduling, zero deps
cronstrue (^3.0.0)       — Human-readable cron descriptions
```

---

## Type Definitions (`src/scheduler/scheduler-types.ts`)

```typescript
/**
 * What happens when a cron job triggers.
 */
export type CronAction =
  | { type: 'claude'; prompt?: string; model?: string; }
  | { type: 'emit'; subject: string; payload?: unknown; }
  | { type: 'skill'; skill: string; params?: Record<string, unknown>; };

/**
 * A cron job definition (from cron.yaml).
 */
export interface CronJobConfig {
  id: string;
  schedule: string;           // cron expression (5 or 6 fields)
  description?: string;
  action: CronAction;
  enabled: boolean;           // default: true
  catchUp: boolean;           // run missed executions on startup, default: false
  timezone?: string;          // IANA timezone, default: system
  protect: boolean;           // skip if previous run still active, default: true
  timeout?: number;           // max execution time in seconds, default: 3600 (1 hour)
}

/**
 * Runtime status of a cron job.
 */
export interface CronJobStatus {
  agentName: string;
  jobId: string;
  description?: string;
  schedule: string;
  scheduleHuman: string;      // "Every day at midnight"
  enabled: boolean;
  running: boolean;
  nextRun?: string;
  lastRun?: string;
  lastStatus?: 'success' | 'error' | 'timeout';
  lastError?: string;
  lastDurationMs?: number;
  runCount: number;
  errorCount: number;
}

/**
 * Persisted state for catch-up detection.
 * Stored in data/daemon-state.json
 */
export interface DaemonState {
  pid?: number;
  startedAt?: string;
  jobs: Record<string, JobState>;   // "agentName:jobId" → state
}

export interface JobState {
  lastRun: string;
  lastStatus: 'success' | 'error' | 'timeout';
  lastError?: string;
  lastDurationMs?: number;
  runCount: number;
  errorCount: number;
}

/**
 * Execution log entry (stored in database as a node).
 */
export interface ExecutionLog {
  agentName: string;
  jobId: string;
  triggeredAt: string;
  completedAt?: string;
  durationMs?: number;
  status: 'running' | 'success' | 'error' | 'timeout';
  error?: string;
  isCatchUp: boolean;
}
```

---

## Claude Code Runner (`src/scheduler/runner.ts`)

The runner is responsible for spawning Claude Code sessions for agent work.

```typescript
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { v4 as uuid } from 'uuid';
import { resolveDbPath } from '../db/connection.js';

export interface RunOptions {
  /** Agent folder path */
  agentDir: string;

  /** Task description / reason for the run */
  prompt: string;

  /** Claude model to use (optional) */
  model?: string;

  /** Max execution time in seconds */
  timeout?: number;

  /** Callback for stdout data */
  onOutput?: (data: string) => void;

  /** Callback for stderr data */
  onError?: (data: string) => void;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

/**
 * Spawn a Claude Code session in an agent's folder.
 *
 * Equivalent to:
 *   cd agents/email-agent && claude -p "Your task: ..."
 *
 * Environment:
 *   AGENTBUS_DB — absolute path to database (so CLI finds it)
 *   AGENTBUS_AGENT — agent name (for context)
 *   AGENTBUS_RUN_ID — unique run ID (for logging)
 */
export async function runAgent(options: RunOptions): Promise<RunResult> {
  const {
    agentDir,
    prompt,
    model,
    timeout = 3600,
    onOutput,
    onError,
  } = options;

  const startTime = Date.now();
  const dbPath = resolveDbPath();
  const agentName = basename(agentDir);
  const runId = uuid();

  // Build claude command
  const args = ['-p', prompt, '--output-format', 'text'];
  if (model) args.push('--model', model);

  return new Promise<RunResult>((resolve) => {
    const child = spawn('claude', args, {
      cwd: agentDir,
      env: {
        ...process.env,
        AGENTBUS_DB: dbPath,
        AGENTBUS_AGENT: agentName,
        AGENTBUS_RUN_ID: runId,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      onOutput?.(text);
    });

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      onError?.(text);
    });

    // Timeout handling
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Give 10s for graceful shutdown, then force kill
      setTimeout(() => child.kill('SIGKILL'), 10000);
    }, timeout * 1000);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        durationMs: Date.now() - startTime,
        timedOut,
      });
    });
  });
}

/**
 * Build the prompt for an agent run.
 *
 * The agent's CLAUDE.md is auto-loaded by Claude Code (it's in the cwd).
 * The -p prompt provides the specific task/reason for this run.
 *
 * If the cron action specifies a skill, we include the skill content
 * in the prompt so the agent knows what to do.
 */
export async function buildPrompt(
  agentDir: string,
  reason: string,
  skillName?: string,
): Promise<string> {
  const parts: string[] = [];

  // Task instruction
  parts.push(`Your task: ${reason}`);
  parts.push('');

  // If a specific skill was requested, include its instructions
  if (skillName) {
    const skillPath = join(agentDir, 'skills', skillName, 'SKILL.md');
    try {
      const skillContent = await readFile(skillPath, 'utf-8');
      parts.push('## Skill Instructions');
      parts.push(skillContent);
      parts.push('');
    } catch {
      // Skill not found — agent can still proceed without it
    }
  }

  // Remind agent about memory
  parts.push('## Memory');
  parts.push('- Read your memory/MEMORY.md for long-term context');
  parts.push('- After completing your task, update memory/MEMORY.md with anything you learned');
  parts.push('- Write a brief log entry to memory/journal/ with today\'s date');
  parts.push('');

  // Remind agent about CLI
  parts.push('## Communication');
  parts.push('- Use `spacestation node list` to see current state');
  parts.push('- Use `spacestation node create` to post findings, reports, or tasks');
  parts.push('- Use `spacestation node reply` to comment on existing items');
  parts.push('- Use `spacestation node update` to change status or assignee');
  parts.push('- Always use `--author ' + basename(agentDir) + '` when creating content');

  return parts.join('\n');
}
```

---

## CronManager (`src/scheduler/scheduler.ts`)

```typescript
import { Cron } from 'croner';
import cronstrue from 'cronstrue';
import EventEmitter from 'eventemitter3';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runAgent, buildPrompt } from './runner.js';
import type {
  CronJobConfig, CronJobStatus, DaemonState, JobState, ExecutionLog
} from './scheduler-types.js';

interface SchedulerEvents {
  'job:start': (log: ExecutionLog) => void;
  'job:complete': (log: ExecutionLog) => void;
  'job:error': (log: ExecutionLog) => void;
}

interface LoadedJob {
  agentName: string;
  agentDir: string;
  config: CronJobConfig;
  cronInstance?: Cron;
  running: boolean;
}

export class CronManager extends EventEmitter<SchedulerEvents> {
  private jobs: Map<string, LoadedJob> = new Map();    // "agentName:jobId"
  private state: DaemonState = { jobs: {} };
  private stateFilePath: string;
  private running = false;

  constructor(stateFilePath: string) {
    super();
    this.stateFilePath = stateFilePath;
  }

  // ── Lifecycle ─────────────────────────────────────────

  async start(): Promise<void> {
    await this.loadState();
    for (const [key, job] of this.jobs) {
      if (job.config.enabled) {
        this.scheduleJob(key, job);
      }
    }
    this.running = true;
    this.state.pid = process.pid;
    this.state.startedAt = new Date().toISOString();
    await this.saveState();
  }

  async stop(): Promise<void> {
    for (const [, job] of this.jobs) {
      job.cronInstance?.stop();
    }
    this.running = false;
    this.state.pid = undefined;
    await this.saveState();
  }

  // ── Job Management ────────────────────────────────────

  addJob(agentName: string, agentDir: string, config: CronJobConfig): void {
    const key = `${agentName}:${config.id}`;
    this.jobs.set(key, {
      agentName,
      agentDir,
      config,
      running: false,
    });
    if (this.running && config.enabled) {
      this.scheduleJob(key, this.jobs.get(key)!);
    }
  }

  removeJob(agentName: string, jobId: string): boolean {
    const key = `${agentName}:${jobId}`;
    const job = this.jobs.get(key);
    if (!job) return false;
    job.cronInstance?.stop();
    this.jobs.delete(key);
    return true;
  }

  // ── Scheduling ────────────────────────────────────────

  private scheduleJob(key: string, job: LoadedJob): void {
    const cron = new Cron(job.config.schedule, {
      timezone: job.config.timezone,
      paused: false,
      protect: job.config.protect,
    }, () => this.executeJob(key));

    job.cronInstance = cron;
  }

  private async executeJob(key: string): Promise<void> {
    const job = this.jobs.get(key);
    if (!job) return;

    // Protect mode
    if (job.config.protect && job.running) return;

    job.running = true;
    const log: ExecutionLog = {
      agentName: job.agentName,
      jobId: job.config.id,
      triggeredAt: new Date().toISOString(),
      status: 'running',
      isCatchUp: false,
    };

    this.emit('job:start', log);

    try {
      const action = job.config.action;
      let prompt: string;

      switch (action.type) {
        case 'claude':
          prompt = await buildPrompt(
            job.agentDir,
            action.prompt ?? job.config.description ?? 'Scheduled run',
          );
          break;

        case 'skill':
          prompt = await buildPrompt(
            job.agentDir,
            `Run your ${action.skill} skill`,
            action.skill,
          );
          break;

        case 'emit':
          // For emit actions, we don't spawn Claude — just publish to the bus
          // (Requires bus integration — deferred to platform integration spec)
          prompt = '';
          break;

        default:
          prompt = await buildPrompt(job.agentDir, 'Scheduled run');
      }

      if (prompt) {
        const result = await runAgent({
          agentDir: job.agentDir,
          prompt,
          model: (action as any).model,
          timeout: job.config.timeout,
          onOutput: (data) => {
            // Optional: stream to log file
          },
        });

        if (result.timedOut) {
          log.status = 'timeout';
          log.error = 'Execution timed out';
        } else if (result.exitCode !== 0) {
          log.status = 'error';
          log.error = result.stderr.slice(-500);  // last 500 chars of stderr
        } else {
          log.status = 'success';
        }

        log.durationMs = result.durationMs;
      }

    } catch (error) {
      log.status = 'error';
      log.error = error instanceof Error ? error.message : String(error);
    } finally {
      log.completedAt = new Date().toISOString();
      job.running = false;

      // Update state
      this.updateJobState(key, log);
      await this.saveState();

      if (log.status === 'success') {
        this.emit('job:complete', log);
      } else {
        this.emit('job:error', log);
      }
    }
  }

  // ── Catch-Up ──────────────────────────────────────────

  async checkMissedRuns(): Promise<void> {
    for (const [key, job] of this.jobs) {
      if (!job.config.catchUp || !job.config.enabled) continue;

      const jobState = this.state.jobs[key];
      if (!jobState?.lastRun) continue;  // first run — not "missed"

      // Check if a run was missed
      const lastRun = new Date(jobState.lastRun);
      const nextAfterLast = new Cron(job.config.schedule, {
        timezone: job.config.timezone,
      }).nextRun(lastRun);

      if (nextAfterLast && nextAfterLast < new Date()) {
        console.log(`Catching up missed run: ${key} (was due ${nextAfterLast.toISOString()})`);
        await this.executeJob(key);
      }
    }
  }

  // ── Manual Trigger ────────────────────────────────────

  async triggerJob(agentName: string, jobId: string): Promise<void> {
    const key = `${agentName}:${jobId}`;
    if (!this.jobs.has(key)) throw new Error(`Job not found: ${key}`);
    await this.executeJob(key);
  }

  /**
   * Run an agent manually (no cron job needed).
   * Used by `spacestation run <agent>`.
   */
  async runAgentManual(agentDir: string, reason: string): Promise<RunResult> {
    const prompt = await buildPrompt(agentDir, reason);
    return runAgent({ agentDir, prompt });
  }

  // ── Status ────────────────────────────────────────────

  listJobs(agentName?: string): CronJobStatus[] {
    const results: CronJobStatus[] = [];
    for (const [key, job] of this.jobs) {
      if (agentName && job.agentName !== agentName) continue;
      const jobState = this.state.jobs[key];
      results.push({
        agentName: job.agentName,
        jobId: job.config.id,
        description: job.config.description,
        schedule: job.config.schedule,
        scheduleHuman: this.describeSchedule(job.config.schedule),
        enabled: job.config.enabled,
        running: job.running,
        nextRun: job.cronInstance?.nextRun()?.toISOString(),
        lastRun: jobState?.lastRun,
        lastStatus: jobState?.lastStatus,
        lastError: jobState?.lastError,
        lastDurationMs: jobState?.lastDurationMs,
        runCount: jobState?.runCount ?? 0,
        errorCount: jobState?.errorCount ?? 0,
      });
    }
    return results;
  }

  describeSchedule(schedule: string): string {
    try { return cronstrue.toString(schedule); }
    catch { return schedule; }
  }

  // ── State Persistence ─────────────────────────────────

  private async loadState(): Promise<void> {
    try {
      const data = await readFile(this.stateFilePath, 'utf-8');
      this.state = JSON.parse(data);
    } catch {
      this.state = { jobs: {} };
    }
  }

  private async saveState(): Promise<void> {
    await writeFile(this.stateFilePath, JSON.stringify(this.state, null, 2));
  }

  private updateJobState(key: string, log: ExecutionLog): void {
    const existing = this.state.jobs[key] ?? { runCount: 0, errorCount: 0 };
    this.state.jobs[key] = {
      lastRun: log.triggeredAt,
      lastStatus: log.status as any,
      lastError: log.error,
      lastDurationMs: log.durationMs,
      runCount: existing.runCount + 1,
      errorCount: existing.errorCount + (log.status !== 'success' ? 1 : 0),
    };
  }
}
```

---

## Daemon Process (`src/scheduler/daemon.ts`)

```typescript
import { CronManager } from './scheduler.js';
import { AgentLoader } from '../agents/agent-loader.js';
import { join } from 'node:path';

/**
 * Start the daemon process.
 * Discovers agent folders, loads cron.yaml files, and starts scheduling.
 */
export async function startDaemon(options: {
  agentsDir: string;
  stateFile: string;
}): Promise<CronManager> {
  const { agentsDir, stateFile } = options;
  const loader = new AgentLoader();
  const scheduler = new CronManager(stateFile);

  // Discover and load agent cron configs
  const manifests = await loader.discoverAgents(agentsDir);
  for (const manifest of manifests) {
    if (manifest.cronConfig) {
      for (const job of manifest.cronConfig.jobs) {
        scheduler.addJob(manifest.config.name, manifest.folderPath, {
          ...job,
          enabled: job.enabled ?? true,
          catchUp: job.catchUp ?? false,
          protect: job.protect ?? true,
          timeout: job.timeout ?? 3600,
        });
      }
    }
  }

  // Check for missed runs before starting
  await scheduler.checkMissedRuns();

  // Start scheduling
  await scheduler.start();

  // Log status
  const jobs = scheduler.listJobs();
  console.log(`Daemon started. ${jobs.length} jobs loaded from ${manifests.length} agents.`);
  for (const job of jobs) {
    const status = job.enabled ? `next: ${job.nextRun ?? 'unknown'}` : 'disabled';
    console.log(`  ${job.agentName}/${job.jobId}: ${job.scheduleHuman} (${status})`);
  }

  // Handle shutdown signals
  const shutdown = async () => {
    console.log('\nShutting down daemon...');
    await scheduler.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return scheduler;
}
```

---

## CLI Commands

### `spacestation daemon`

```
Usage: spacestation daemon <command>

Commands:
  start           Start the daemon (foreground)
  start -d        Start in background (detached)
  stop            Stop a running daemon
  status          Show daemon and job status
  logs            Show recent execution logs

Options (start):
  -d, --detach        Run in background
  --agents <dir>      Agents directory (default: ./agents)
  --state <file>      State file (default: ./data/daemon-state.json)

Examples:
  spacestation daemon start                    # foreground
  spacestation daemon start -d                 # background
  spacestation daemon status
  spacestation daemon stop
```

**Status output:**
```
Daemon: running (PID 12345, since 2026-03-15T08:00:00Z)
Jobs: 4 loaded, 3 enabled, 1 disabled

  AGENT            JOB                SCHEDULE                  NEXT RUN        LAST RUN   STATUS
  email-agent      nightly-check      Every day at midnight     in 6h 15m       8h ago     success
  email-agent      morning-report     Mon-Fri at 9:00 AM        in 14h 30m      1d ago     success
  patrol-agent     evening-sweep      Every day at 6:00 PM      in 2h 45m       1d ago     success
  reviewer-agent   weekly-review      Every Monday at 10:00 AM  in 4d 16h       5d ago     disabled
```

### `spacestation run`

Manual one-shot agent execution (no cron needed).

```
Usage: spacestation run <agent-name> [options]

Options:
  --reason <text>       Why this run is happening (default: "Manual run")
  --skill <name>        Run a specific skill
  --model <model>       Claude model to use
  --timeout <seconds>   Max execution time (default: 3600)
  --dir <path>          Agents directory (default: ./agents)

Examples:
  spacestation run email-agent --reason "Check for urgent emails"
  spacestation run reviewer-agent --skill code-review --reason "Review PR #42"
  spacestation run job-hunter --reason "Search for new postings" --timeout 600
```

---

## cron.yaml Schema (Updated for Claude Code)

```yaml
jobs:
  - id: nightly-email-check
    schedule: "0 0 * * *"
    description: "Check inbox and post findings to wiki"
    action:
      type: claude                    # spawn a Claude Code session
      prompt: "Run your nightly email check. Check for unread messages, classify priority, and post a report."
      model: sonnet                   # optional model override
    enabled: true
    catchUp: true
    timezone: "Australia/Sydney"
    protect: true
    timeout: 1800                     # 30 minutes max

  - id: morning-report
    schedule: "0 9 * * 1-5"
    description: "Generate daily summary"
    action:
      type: skill                     # run a specific skill
      skill: summarize
      params:
        scope: "yesterday"
    enabled: true

  - id: hourly-heartbeat
    schedule: "0 * * * *"
    description: "Quick health check"
    action:
      type: claude
      prompt: "Quick check: are there any open tasks assigned to you? If yes, report status. If no, respond with HEARTBEAT_OK."
    enabled: true
    timeout: 300                      # 5 minutes max
```

---

## Implementation Notes

### Background Daemon

For `spacestation daemon start -d` (detached mode), use Node.js `child_process.fork()` with `detached: true` and `stdio: 'ignore'`. Write PID to `data/daemon.pid`. The `stop` command reads the PID file and sends SIGTERM.

### Execution Logging

Each agent run can optionally be logged as a node in the database:
```
spacestation node create --type report \
  --title "Run: email-agent/nightly-check" \
  --parent agents/email-agent \
  --author daemon \
  --meta '{"jobId":"nightly-check","status":"success","durationMs":45000}'
```

This gives full visibility in the web UI — you can see every agent run, its duration, and whether it succeeded.

### Claude Code Availability

The daemon assumes `claude` is in the PATH. On first start, it should verify:
```typescript
try {
  execSync('claude --version', { stdio: 'pipe' });
} catch {
  throw new Error('Claude Code CLI not found. Install it first: npm install -g @anthropic-ai/claude-code');
}
```

### Concurrency Control

By default, the daemon runs one agent at a time (serialized). This prevents:
- SQLite write contention
- Overlapping agent work on the same resources
- Excessive API costs

Optional: `--concurrency <n>` flag to allow N agents to run simultaneously.
