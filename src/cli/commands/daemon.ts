import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { DaemonState } from '../../scheduler/scheduler-types.js';

function resolveStateFile(opts: { state?: string }): string {
  return resolve(opts.state ?? './data/daemon-state.json');
}

async function readState(stateFile: string): Promise<DaemonState | null> {
  try {
    const raw = await readFile(stateFile, 'utf-8');
    return JSON.parse(raw) as DaemonState;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function registerDaemonCommands(program: Command): void {
  const daemon = program.command('daemon').description('Daemon lifecycle and status');

  daemon.command('start')
    .description('Start the scheduler daemon (foreground)')
    .option('--agents <dir>', 'Agents directory', './agents')
    .option('--state <file>', 'State file path', './data/daemon-state.json')
    .action(async (opts) => {
      try {
        const { startDaemon } = await import('../../scheduler/index.js');
        const agentsDir = resolve(opts.agents);
        const stateFile = resolve(opts.state);

        console.log(`Starting daemon...`);
        console.log(`  Agents: ${agentsDir}`);
        console.log(`  State:  ${stateFile}`);

        // startDaemon keeps the process alive via cron timers + signal handlers
        await startDaemon({ agentsDir, stateFile });
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  daemon.command('stop')
    .description('Stop a running daemon')
    .option('--state <file>', 'State file path', './data/daemon-state.json')
    .action(async (opts) => {
      try {
        const stateFile = resolveStateFile(opts);
        const state = await readState(stateFile);

        if (!state?.pid) {
          console.error('Error: No daemon PID found. Is the daemon running?');
          process.exitCode = 1;
          return;
        }

        if (!isProcessRunning(state.pid)) {
          console.error(`Error: Daemon process ${state.pid} is not running (stale PID).`);
          process.exitCode = 1;
          return;
        }

        process.kill(state.pid, 'SIGTERM');
        console.log(`Sent SIGTERM to daemon (PID ${state.pid}).`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  daemon.command('status')
    .description('Show daemon and job status')
    .option('--state <file>', 'State file path', './data/daemon-state.json')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      try {
        const stateFile = resolveStateFile(opts);
        const state = await readState(stateFile);

        if (!state) {
          console.log('Daemon: not running (no state file)');
          return;
        }

        const pid = state.pid;
        const running = pid ? isProcessRunning(pid) : false;

        if (opts.json) {
          console.log(JSON.stringify({ ...state, running }, null, 2));
          return;
        }

        if (running && pid) {
          console.log(`Daemon: ${chalk.green('running')} (PID ${pid}, since ${state.startedAt})`);
        } else {
          console.log(`Daemon: ${chalk.red('stopped')}`);
        }

        const jobEntries = Object.entries(state.jobs);
        if (jobEntries.length === 0) {
          console.log('No jobs loaded.');
          return;
        }

        const enabled = jobEntries.filter(([, j]) => j.lastStatus !== undefined).length;
        console.log(`Jobs: ${jobEntries.length} loaded`);
        console.log('');

        const table = new Table({
          head: ['AGENT', 'JOB', 'LAST RUN', 'STATUS'],
          style: { head: ['dim'] },
        });

        for (const [key, job] of jobEntries) {
          const [agentName, ...jobParts] = key.split(':');
          const jobId = jobParts.join(':');
          table.push([
            agentName,
            jobId,
            job.lastRun ? timeAgo(job.lastRun) : '-',
            formatStatus(job.lastStatus),
          ]);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });
}

function formatStatus(status?: string): string {
  if (!status) return '-';
  if (status === 'success') return chalk.green(status);
  if (status === 'error') return chalk.red(status);
  if (status === 'timeout') return chalk.yellow(status);
  return status;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
