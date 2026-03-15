import { eq, desc } from 'drizzle-orm';
import { getDb } from './connection.js';
import { agentRuns, type RunStatus, type RunTrigger } from './schema.js';
import { v4 as uuid } from 'uuid';

export interface AgentRun {
  id: string;
  agentName: string;
  jobId: string | null;
  trigger: RunTrigger;
  status: RunStatus;
  prompt: string | null;
  exitCode: number | null;
  durationMs: number | null;
  error: string | null;
  nodesCreated: number;
  nodesUpdated: number;
  startedAt: string;
  completedAt: string | null;
}

export function logRunStart(agentName: string, trigger: RunTrigger, jobId?: string, prompt?: string): string {
  const db = getDb();
  const id = uuid();
  const now = new Date().toISOString();

  db.insert(agentRuns).values({
    id,
    agentName,
    jobId: jobId ?? null,
    trigger,
    status: 'running',
    prompt: prompt ?? null,
    exitCode: null,
    durationMs: null,
    error: null,
    nodesCreated: 0,
    nodesUpdated: 0,
    startedAt: now,
    completedAt: null,
  }).run();

  return id;
}

export function logRunComplete(
  runId: string,
  status: RunStatus,
  durationMs: number,
  exitCode?: number,
  error?: string,
): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.update(agentRuns).set({
    status,
    exitCode: exitCode ?? null,
    durationMs,
    error: error ?? null,
    completedAt: now,
  }).where(eq(agentRuns.id, runId)).run();
}

export function getRunHistory(agentName?: string, limit: number = 20): AgentRun[] {
  const db = getDb();
  let query = db.select().from(agentRuns);
  if (agentName) {
    query = query.where(eq(agentRuns.agentName, agentName)) as any;
  }
  return query.orderBy(desc(agentRuns.startedAt)).limit(limit).all() as AgentRun[];
}

export function getRunStats(agentName?: string): {
  totalRuns: number;
  successRate: number;
  avgDurationMs: number;
  lastRun: string | null;
} {
  const runs = getRunHistory(agentName, 100);
  if (runs.length === 0) {
    return { totalRuns: 0, successRate: 0, avgDurationMs: 0, lastRun: null };
  }

  const completed = runs.filter(r => r.status !== 'running');
  const successes = completed.filter(r => r.status === 'success');
  const durations = completed.filter(r => r.durationMs != null).map(r => r.durationMs!);

  return {
    totalRuns: runs.length,
    successRate: completed.length > 0 ? successes.length / completed.length : 0,
    avgDurationMs: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    lastRun: runs[0]?.startedAt ?? null,
  };
}
