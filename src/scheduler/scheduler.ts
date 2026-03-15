import { Cron } from 'croner';
import cronstrue from 'cronstrue';
import { EventEmitter } from 'eventemitter3';
import { readFile, writeFile } from 'node:fs/promises';
import { runAgent, buildPrompt } from './runner.js';
import type { RunResult } from './runner.js';
import type {
  CronJobConfig, CronJobStatus, DaemonState, ExecutionLog, SchedulerEvents,
} from './scheduler-types.js';

// Lazy-load run logging to avoid circular deps
let _logRunStart: ((name: string, trigger: 'cron' | 'manual' | 'webhook', jobId?: string, prompt?: string) => string) | null = null;
let _logRunComplete: ((id: string, status: 'running' | 'success' | 'error' | 'timeout', ms: number, code?: number, err?: string) => void) | null = null;

async function ensureRunLog() {
  if (!_logRunStart) {
    try {
      const { logRunStart, logRunComplete } = await import('../db/run-log.js');
      _logRunStart = logRunStart;
      _logRunComplete = logRunComplete;
    } catch {
      // DB not available, skip run logging
    }
  }
}

interface LoadedJob {
  agentName: string;
  agentDir: string;
  config: CronJobConfig;
  cronInstance?: Cron;
  running: boolean;
}

export class CronManager extends EventEmitter<SchedulerEvents> {
  private jobs: Map<string, LoadedJob> = new Map();
  private state: DaemonState = { jobs: {} };
  private stateFilePath: string;
  private running = false;

  constructor(stateFilePath: string) {
    super();
    this.stateFilePath = stateFilePath;
  }

  // Lifecycle

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

  // Job Management

  addJob(agentName: string, agentDir: string, config: CronJobConfig): void {
    const key = `${agentName}:${config.id}`;
    this.jobs.set(key, { agentName, agentDir, config, running: false });
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

  // Scheduling

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

    // Log run start to database
    await ensureRunLog();
    let runLogId: string | undefined;
    try {
      runLogId = _logRunStart?.(job.agentName, 'cron', job.config.id);
    } catch { /* ignore logging errors */ }

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
          // Emit actions publish to the bus -- deferred to platform integration
          prompt = '';
          break;

        default:
          prompt = await buildPrompt(job.agentDir, 'Scheduled run');
      }

      if (prompt) {
        const result = await runAgent({
          agentDir: job.agentDir,
          prompt,
          model: (action as { model?: string }).model,
          timeout: job.config.timeout,
          onOutput: () => {},
        });

        if (result.timedOut) {
          log.status = 'timeout';
          log.error = 'Execution timed out';
        } else if (result.exitCode !== 0) {
          log.status = 'error';
          log.error = result.stderr.slice(-500);
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

      // Log run completion to database
      try {
        if (runLogId && _logRunComplete) {
          _logRunComplete(runLogId, log.status as any, log.durationMs ?? 0, undefined, log.error ?? undefined);
        }
      } catch { /* ignore logging errors */ }

      this.updateJobState(key, log);
      await this.saveState();

      if (log.status === 'success') {
        this.emit('job:complete', log);
      } else {
        this.emit('job:error', log);
      }
    }
  }

  // Catch-Up

  async checkMissedRuns(): Promise<void> {
    for (const [key, job] of this.jobs) {
      if (!job.config.catchUp || !job.config.enabled) continue;

      const jobState = this.state.jobs[key];
      if (!jobState?.lastRun) continue;

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

  // Manual Trigger

  async triggerJob(agentName: string, jobId: string): Promise<void> {
    const key = `${agentName}:${jobId}`;
    if (!this.jobs.has(key)) throw new Error(`Job not found: ${key}`);
    await this.executeJob(key);
  }

  async runAgentManual(agentDir: string, reason: string): Promise<RunResult> {
    const prompt = await buildPrompt(agentDir, reason);
    return runAgent({ agentDir, prompt });
  }

  // Status

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

  // State Persistence

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
      lastStatus: log.status as 'success' | 'error' | 'timeout',
      lastError: log.error,
      lastDurationMs: log.durationMs,
      runCount: existing.runCount + 1,
      errorCount: existing.errorCount + (log.status !== 'success' ? 1 : 0),
    };
  }
}
