# Spec 03: Cron Scheduler

## Summary

A cron-based scheduling system that triggers agent actions at specified times. Uses the `croner` library for cron expression parsing and scheduling. Actions include waking agents, emitting bus events, and invoking skills. Supports catch-up for missed runs after restarts.

## Files to Create

```
src/scheduler/
  scheduler-types.ts     # Type definitions
  scheduler.ts           # CronManager implementation
  index.ts               # Public exports
  __tests__/
    scheduler.test.ts    # Tests

src/cli/commands/
  cron.ts                # CLI commands
```

## New Dependencies

```
croner (^9.0.0) — Zero-dep, TypeScript-native cron scheduling
cronstrue (^2.50.0) — Human-readable cron expression descriptions
```

---

## Type Definitions (`src/scheduler/scheduler-types.ts`)

```typescript
/**
 * What happens when a cron job triggers.
 */
export type CronAction =
  | { type: 'wake'; reason: string }
  | { type: 'emit'; subject: string; payload?: unknown }
  | { type: 'skill'; skill: string; params?: Record<string, unknown> };

/**
 * Configuration for a single cron job.
 * This is the in-memory representation used by CronManager.
 */
export interface CronJobConfig {
  /** Unique ID within the agent (e.g., "nightly-check") */
  id: string;

  /** Standard cron expression (5 or 6 fields) */
  schedule: string;

  /** Human-readable description */
  description?: string;

  /** What to do when the job triggers */
  action: CronAction;

  /** Whether the job is active */
  enabled: boolean;

  /** Run missed executions on startup (default: false) */
  catchUp: boolean;

  /** Timezone for schedule evaluation (default: system timezone) */
  timezone?: string;

  /**
   * Skip execution if previous run is still active (default: true).
   * When true, the scheduler will not trigger a new run if the previous
   * one hasn't completed yet.
   */
  protect: boolean;
}

/**
 * Handle to a scheduled cron job (wraps the croner Cron instance).
 */
export interface CronJobHandle {
  /** Composite key: agentId:jobId */
  key: string;

  /** Agent this job belongs to */
  agentId: string;
  agentName: string;

  /** Job configuration */
  config: CronJobConfig;

  /** Whether the job is currently running (for protect mode) */
  running: boolean;

  /** Stop this job's scheduling */
  stop(): void;

  /** Resume this job's scheduling */
  resume(): void;
}

/**
 * Runtime status of a cron job (for display/API).
 */
export interface CronJobStatus {
  agentId: string;
  agentName: string;
  jobId: string;
  description?: string;
  schedule: string;
  scheduleHuman: string;      // e.g., "Every day at midnight"
  enabled: boolean;
  running: boolean;
  nextRun?: string;           // ISO timestamp of next scheduled run
  lastRun?: string;           // ISO timestamp of last run
  lastStatus?: 'success' | 'error';
  lastError?: string;
  runCount: number;
  errorCount: number;
}

/**
 * Event emitted when a cron job triggers.
 */
export interface CronTriggerEvent {
  agentId: string;
  agentName: string;
  jobId: string;
  schedule: string;
  action: CronAction;
  triggeredAt: string;        // ISO timestamp
  isCatchUp: boolean;         // true if this is a missed-run catch-up
}

/**
 * Event emitted when a cron job completes.
 */
export interface CronCompleteEvent {
  agentId: string;
  agentName: string;
  jobId: string;
  triggeredAt: string;
  completedAt: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

/**
 * Result of catch-up check on startup.
 */
export interface CronCatchUpResult {
  agentId: string;
  agentName: string;
  jobId: string;
  missedAt: string;           // when the run should have happened
  executed: boolean;          // whether we ran it
  error?: string;
}

/**
 * Persisted state for catch-up detection.
 * Stored in ~/.agentbus/cron-state.json
 */
export interface CronStateFile {
  /** Map of "agentName:jobId" → last run state */
  jobs: Record<string, CronJobState>;
  savedAt: string;
}

export interface CronJobState {
  lastRun: string;            // ISO timestamp
  lastStatus: 'success' | 'error';
  lastError?: string;
  runCount: number;
  errorCount: number;
}

/**
 * Events emitted by CronManager.
 */
export interface SchedulerEvents {
  'job:triggered': (event: CronTriggerEvent) => void;
  'job:completed': (event: CronCompleteEvent) => void;
  'job:error': (event: CronTriggerEvent & { error: Error }) => void;
}
```

---

## CronManager (`src/scheduler/scheduler.ts`)

```typescript
import { Cron } from 'croner';
import cronstrue from 'cronstrue';
import EventEmitter from 'eventemitter3';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { AgentBusPlatform } from '../platform.js';
import type {
  CronJobConfig, CronJobHandle, CronJobStatus, CronAction,
  CronTriggerEvent, CronCompleteEvent, CronCatchUpResult,
  CronStateFile, CronJobState, SchedulerEvents
} from './scheduler-types.js';

export class CronManager extends EventEmitter<SchedulerEvents> {
  private platform: AgentBusPlatform;
  private jobs: Map<string, CronJobHandle> = new Map();  // key: "agentName:jobId"
  private cronInstances: Map<string, Cron> = new Map();
  private state: Map<string, CronJobState> = new Map();   // persisted state
  private stateFilePath: string;
  private running = false;

  constructor(platform: AgentBusPlatform) {
    super();
    this.platform = platform;
    this.stateFilePath = join(platform.config.dataDir, 'cron-state.json');
  }

  // ── Lifecycle ─────────────────────────────────────────

  /**
   * Start all enabled cron schedules.
   * Call this after all jobs have been loaded.
   */
  start(): void {
    // 1. Load persisted state from cron-state.json
    // 2. For each enabled job in this.jobs:
    //    a. Create Cron instance with schedule and timezone
    //    b. Attach trigger callback
    //    c. Store in cronInstances map
    // 3. Set running = true
  }

  /**
   * Stop all cron schedules gracefully.
   * Waits for any running jobs to complete.
   */
  stop(): void {
    // 1. For each Cron instance, call .stop()
    // 2. Save state to disk
    // 3. Set running = false
  }

  // ── Job Management ────────────────────────────────────

  /**
   * Add a cron job for an agent.
   * If the scheduler is already running, the job starts immediately.
   */
  addJob(agentId: string, agentName: string, config: CronJobConfig): CronJobHandle {
    // 1. Validate cron expression (try new Cron(config.schedule, { paused: true }))
    // 2. Create CronJobHandle
    // 3. Store in jobs map under "agentName:jobId"
    // 4. If running, create and start Cron instance
    // 5. Return handle
  }

  /**
   * Remove a cron job.
   */
  removeJob(agentName: string, jobId: string): boolean {
    // Stop Cron instance, remove from maps
  }

  /**
   * Enable a previously disabled job.
   */
  enableJob(agentName: string, jobId: string): boolean {
    // Update config.enabled, start Cron instance if scheduler is running
  }

  /**
   * Disable a job (stops scheduling but keeps config).
   */
  disableJob(agentName: string, jobId: string): boolean {
    // Stop Cron instance, set config.enabled = false
  }

  /**
   * Manually trigger a job immediately (outside its schedule).
   */
  async triggerJob(agentName: string, jobId: string): Promise<void> {
    // Execute the job's action as if the cron fired
  }

  // ── Loading from Agent Folders ────────────────────────

  /**
   * Load cron jobs from a parsed cron.yaml config.
   * Called by AgentManager when loading agent folders.
   */
  loadFromConfig(agentId: string, agentName: string, jobs: CronJobConfig[]): CronJobHandle[] {
    return jobs.map(job => this.addJob(agentId, agentName, job));
  }

  // ── Status ────────────────────────────────────────────

  /**
   * List all jobs, optionally filtered by agent.
   */
  listJobs(agentName?: string): CronJobStatus[] {
    // Map jobs to CronJobStatus, including human-readable schedule
    // Use cronstrue.toString(schedule) for scheduleHuman
    // Include next run time from Cron instance
    // Include last run info from state
  }

  /**
   * Get next N run times for a job.
   */
  nextRuns(agentName: string, jobId: string, count: number = 5): Date[] {
    // Use Cron.nextRuns(count) from croner
  }

  /**
   * Get last run timestamp for a job.
   */
  getLastRun(agentName: string, jobId: string): string | undefined {
    const key = `${agentName}:${jobId}`;
    return this.state.get(key)?.lastRun;
  }

  // ── Catch-Up ──────────────────────────────────────────

  /**
   * Check for missed runs since last shutdown.
   * For jobs with catchUp: true, execute immediately.
   */
  async checkMissedRuns(): Promise<CronCatchUpResult[]> {
    // For each job where config.catchUp === true:
    // 1. Get lastRun from state
    // 2. If no lastRun, skip (first time — not "missed")
    // 3. Calculate what the next run AFTER lastRun would have been
    //    (use croner's Cron to compute: new Cron(schedule).nextRun(new Date(lastRun)))
    // 4. If that next run is in the past, the job was missed
    // 5. Execute the job action immediately
    // 6. Return results
  }

  // ── Action Execution ──────────────────────────────────

  /**
   * Execute a cron action.
   * This is the core dispatcher called when a cron job triggers.
   */
  private async executeAction(
    agentId: string,
    agentName: string,
    jobId: string,
    action: CronAction,
    isCatchUp: boolean = false
  ): Promise<void> {
    const handle = this.jobs.get(`${agentName}:${jobId}`);
    if (!handle) return;

    // Protect mode: skip if already running
    if (handle.config.protect && handle.running) {
      return;
    }

    handle.running = true;
    const triggeredAt = new Date().toISOString();

    // Emit trigger event
    const triggerEvent: CronTriggerEvent = {
      agentId, agentName, jobId,
      schedule: handle.config.schedule,
      action, triggeredAt, isCatchUp,
    };
    this.emit('job:triggered', triggerEvent);

    try {
      switch (action.type) {
        case 'wake':
          // Wake the agent via WakeManager
          await this.platform.wake.wake(agentId, action.reason);
          break;

        case 'emit':
          // Publish event to the message bus
          this.platform.bus.publish(action.subject, action.payload ?? {}, {
            from: agentName,
            type: 'event',
          });
          break;

        case 'skill':
          // Publish skill invocation event
          // The skill system listens for _skill.{agentName}.{skillId} events
          this.platform.bus.publish(`_skill.${agentName}.${action.skill}`, {
            params: action.params ?? {},
            triggeredBy: 'cron',
            jobId,
          }, { from: agentName, type: 'event' });
          break;
      }

      // Update state
      this.updateState(`${agentName}:${jobId}`, {
        lastRun: triggeredAt,
        lastStatus: 'success',
      });

      // Emit completion event
      this.emit('job:completed', {
        agentId, agentName, jobId, triggeredAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - new Date(triggeredAt).getTime(),
        success: true,
      });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      this.updateState(`${agentName}:${jobId}`, {
        lastRun: triggeredAt,
        lastStatus: 'error',
        lastError: errorMsg,
      });

      this.emit('job:error', { ...triggerEvent, error: error as Error });

    } finally {
      handle.running = false;
    }
  }

  // ── State Persistence ─────────────────────────────────

  /**
   * Load persisted state from disk.
   */
  private async loadState(): Promise<void> {
    // Read cron-state.json, parse, populate this.state map
    // Silently ignore if file doesn't exist (first run)
  }

  /**
   * Save state to disk.
   */
  async saveState(): Promise<void> {
    // Serialize this.state to CronStateFile format
    // Write to cron-state.json
  }

  /**
   * Update state for a specific job.
   */
  private updateState(key: string, update: Partial<CronJobState>): void {
    const existing = this.state.get(key) ?? {
      lastRun: '', lastStatus: 'success' as const, runCount: 0, errorCount: 0,
    };
    const updated = { ...existing, ...update };
    if (update.lastStatus === 'success') updated.runCount++;
    if (update.lastStatus === 'error') updated.errorCount++;
    this.state.set(key, updated);
    // Debounced save (don't write on every trigger — batch saves)
  }

  // ── Helpers ───────────────────────────────────────────

  /**
   * Get human-readable description of a cron expression.
   */
  describeSchedule(schedule: string): string {
    try {
      return cronstrue.toString(schedule);
    } catch {
      return schedule;
    }
  }
}
```

---

## croner Usage Reference

```typescript
import { Cron } from 'croner';

// Create a scheduled job
const job = new Cron('0 0 * * *', {
  timezone: 'America/New_York',
  paused: false,                  // start immediately
  protect: true,                  // skip if previous run still active
}, async () => {
  // This runs at midnight ET every day
});

// Control
job.pause();
job.resume();
job.stop();

// Query
job.nextRun();                    // Date | null
job.nextRuns(5);                  // Date[]
job.isRunning();                  // boolean (if protect mode)
job.isStopped();                  // boolean

// Validate expression
try {
  new Cron('invalid', { paused: true });
} catch (e) {
  // Invalid cron expression
}
```

---

## CLI Commands (`src/cli/commands/cron.ts`)

```typescript
import { Command } from 'commander';
import { getPlatform } from '../../platform.js';

export function registerCronCommands(program: Command): void {
  const cron = program.command('cron').description('Cron scheduler operations');

  cron
    .command('list')
    .description('List all scheduled cron jobs')
    .option('-a, --agent <name>', 'Filter by agent')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      // platform.scheduler.listJobs(opts.agent)
      // Display table: Agent | Job ID | Schedule | Description | Enabled | Next Run | Last Run
    });

  cron
    .command('status')
    .description('Show next upcoming runs across all agents')
    .option('-n, --limit <n>', 'Number of upcoming runs to show', '10')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      // Collect nextRun from all jobs, sort by time, display chronologically
    });

  cron
    .command('trigger <agent> <job-id>')
    .description('Manually trigger a cron job now')
    .action(async (agent, jobId) => {
      // platform.scheduler.triggerJob(agent, jobId)
    });

  cron
    .command('enable <agent> <job-id>')
    .description('Enable a cron job')
    .action(async (agent, jobId) => {
      // platform.scheduler.enableJob(agent, jobId)
    });

  cron
    .command('disable <agent> <job-id>')
    .description('Disable a cron job')
    .action(async (agent, jobId) => {
      // platform.scheduler.disableJob(agent, jobId)
    });

  cron
    .command('history')
    .description('Show cron job execution history')
    .option('-a, --agent <name>', 'Filter by agent')
    .option('-n, --limit <n>', 'Number of entries', '20')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      // Read from state, display: Time | Agent | Job | Status | Duration
    });
}
```

---

## Integration Points

### With WakeManager (type: 'wake')

```
CronManager.executeAction({ type: 'wake', reason: 'Nightly check' })
  → platform.wake.wake(agentId, reason)
    → WakeManager publishes to _wake.{agentName}
    → Agent status → 'online'
    → Wake handler fires with AgentContext
```

### With MessageBus (type: 'emit')

```
CronManager.executeAction({ type: 'emit', subject: 'heartbeat.X', payload: {} })
  → platform.bus.publish(subject, payload)
    → Any subscribed agents receive the message
    → WakeManager checks patterns → may wake additional agents
```

### With Skills (type: 'skill')

```
CronManager.executeAction({ type: 'skill', skill: 'summarize', params: {} })
  → platform.bus.publish('_skill.agentName.summarize', { params, triggeredBy: 'cron' })
    → SkillRegistry (or agent's message handler) processes the skill invocation
```

### State Persistence

The scheduler saves state to `~/.agentbus/cron-state.json` alongside existing `registry.json` and `memory.json`. The state file is updated:
- After each job execution (debounced to avoid excessive writes)
- On `stop()` / `saveState()` call
- Before shutdown (via platform.shutdown())

---

## Tests (`src/scheduler/__tests__/scheduler.test.ts`)

```typescript
import { CronManager } from '../scheduler.js';
import type { CronJobConfig } from '../scheduler-types.js';
// Need a mock platform or minimal platform for testing

describe('CronManager', () => {
  let scheduler: CronManager;
  // Setup with mock platform (mock bus, mock wake, mock registry)

  afterEach(() => {
    scheduler.stop();
  });

  describe('addJob', () => {
    test('adds job with valid cron expression');
    test('throws on invalid cron expression');
    test('applies default values (enabled, catchUp, protect)');
    test('starts job immediately if scheduler is running');
    test('does not start job if scheduler is not running');
    test('rejects duplicate job key (agentName:jobId)');
  });

  describe('removeJob', () => {
    test('removes existing job');
    test('stops the cron instance');
    test('returns false for non-existent job');
  });

  describe('enableJob / disableJob', () => {
    test('enable starts the cron instance');
    test('disable stops the cron instance');
    test('enable on already-enabled is no-op');
    test('disable on already-disabled is no-op');
  });

  describe('start / stop', () => {
    test('start activates all enabled jobs');
    test('start skips disabled jobs');
    test('stop pauses all jobs');
    test('stop saves state');
    test('start after stop resumes correctly');
  });

  describe('triggerJob', () => {
    test('executes job action immediately');
    test('throws for non-existent job');
    test('works even if scheduler is not running');
  });

  describe('executeAction', () => {
    test('wake action calls platform.wake.wake()');
    test('emit action calls platform.bus.publish()');
    test('skill action publishes _skill event');
    test('protect mode skips if job is already running');
    test('emits job:triggered event');
    test('emits job:completed event on success');
    test('emits job:error event on failure');
    test('updates state after execution');
    test('sets running=false even on error (finally block)');
  });

  describe('listJobs', () => {
    test('returns all jobs');
    test('filters by agent name');
    test('includes human-readable schedule description');
    test('includes next run time');
    test('includes last run info from state');
  });

  describe('nextRuns', () => {
    test('returns next N run dates');
    test('throws for non-existent job');
  });

  describe('catch-up', () => {
    test('detects missed run when lastRun is old');
    test('executes missed run for catchUp: true jobs');
    test('skips missed run for catchUp: false jobs');
    test('handles first run (no lastRun in state)');
    test('marks catch-up executions with isCatchUp flag');
  });

  describe('state persistence', () => {
    test('saves state to file');
    test('loads state from file');
    test('handles missing state file (first run)');
    test('increments runCount on success');
    test('increments errorCount on error');
  });

  describe('describeSchedule', () => {
    test('converts "0 0 * * *" to "Every day at 12:00 AM"');
    test('converts "*/5 * * * *" to "Every 5 minutes"');
    test('converts "0 9 * * 1-5" to "At 9:00 AM, Monday through Friday"');
    test('returns raw expression on parse failure');
  });
});
```

### Expected Test Count: ~40-45 tests

---

## Implementation Notes

### Cron Expression Format

croner supports both 5-field (minute-based) and 6-field (second-based) expressions:

| Fields | Format | Example |
|--------|--------|---------|
| 5 | `min hour dom month dow` | `0 0 * * *` (midnight daily) |
| 6 | `sec min hour dom month dow` | `0 0 0 * * *` (midnight daily, with seconds) |

### Debounced State Saving

To avoid writing `cron-state.json` after every single job execution (which could be frequent with minute-interval jobs), use a debounce:

```typescript
private saveTimer?: NodeJS.Timeout;

private debouncedSave(): void {
  if (this.saveTimer) clearTimeout(this.saveTimer);
  this.saveTimer = setTimeout(() => this.saveState(), 5000);  // 5s debounce
}
```

### Timezone Handling

croner natively supports IANA timezones via the `timezone` option. If no timezone is specified in the job config, the system timezone is used (croner's default behavior).

### Error Isolation

A failing job should never crash the scheduler or affect other jobs. All action execution is wrapped in try/catch. Errors are logged to state and emitted as events.
