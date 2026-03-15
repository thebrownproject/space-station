/**
 * What happens when a cron job triggers.
 */
export type CronAction =
  | { type: 'claude'; prompt?: string; model?: string }
  | { type: 'emit'; subject: string; payload?: unknown }
  | { type: 'skill'; skill: string; params?: Record<string, unknown> };

/**
 * A cron job definition (resolved from cron.yaml with defaults applied).
 */
export interface CronJobConfig {
  id: string;
  schedule: string;
  description?: string;
  action: CronAction;
  enabled: boolean;
  catchUp: boolean;
  timezone?: string;
  protect: boolean;
  timeout?: number;
}

/**
 * Runtime status of a cron job.
 */
export interface CronJobStatus {
  agentName: string;
  jobId: string;
  description?: string;
  schedule: string;
  scheduleHuman: string;
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
  jobs: Record<string, JobState>;
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

/**
 * Events emitted by CronManager.
 */
export interface SchedulerEvents {
  'job:start': (log: ExecutionLog) => void;
  'job:complete': (log: ExecutionLog) => void;
  'job:error': (log: ExecutionLog) => void;
}
