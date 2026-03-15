import { spawn } from 'node:child_process';
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
 * Environment:
 *   AGENTBUS_DB    -- absolute path to database (so CLI finds it)
 *   AGENTBUS_AGENT -- agent name (for context)
 *   AGENTBUS_RUN_ID -- unique run ID (for logging)
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

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Grace period before force kill
      setTimeout(() => child.kill('SIGKILL'), 10_000);
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
 */
export async function buildPrompt(
  agentDir: string,
  reason: string,
  skillName?: string,
): Promise<string> {
  const parts: string[] = [];

  parts.push(`Your task: ${reason}`);
  parts.push('');

  if (skillName) {
    const skillPath = join(agentDir, 'skills', skillName, 'SKILL.md');
    try {
      const skillContent = await readFile(skillPath, 'utf-8');
      parts.push('## Skill Instructions');
      parts.push(skillContent);
      parts.push('');
    } catch {
      // Skill file not found -- agent proceeds without it
    }
  }

  parts.push('## Memory');
  parts.push('- Read your memory/MEMORY.md for long-term context');
  parts.push('- After completing your task, update memory/MEMORY.md with anything you learned');
  parts.push('- Write a brief log entry to memory/journal/ with today\'s date');
  parts.push('');

  parts.push('## Communication');
  parts.push('- Use `spacestation node list` to see current state');
  parts.push('- Use `spacestation node create` to post findings, reports, or tasks');
  parts.push('- Use `spacestation node reply` to comment on existing items');
  parts.push('- Use `spacestation node update` to change status or assignee');
  parts.push('- Always use `--author ' + basename(agentDir) + '` when creating content');

  return parts.join('\n');
}
