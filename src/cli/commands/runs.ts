import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { formatJson, timeAgo, formatDuration } from '../formatters.js';

export function registerRunsCommand(program: Command): void {
  program
    .command('runs')
    .description('Show agent run history')
    .option('-a, --agent <name>', 'Filter by agent name')
    .option('-n, --limit <n>', 'Max entries', '20')
    .option('--stats', 'Show aggregate statistics')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      try {
        const { runMigrations } = await import('../../db/migrate.js');
        const { getRunHistory, getRunStats } = await import('../../db/run-log.js');
        runMigrations();

        if (opts.stats) {
          const stats = getRunStats(opts.agent);
          if (opts.json) {
            console.log(formatJson(stats));
            return;
          }
          console.log(chalk.bold('Agent Run Statistics'));
          console.log(chalk.dim('===================='));
          console.log(`  Total runs:    ${stats.totalRuns}`);
          console.log(`  Success rate:  ${chalk.green((stats.successRate * 100).toFixed(0) + '%')}`);
          console.log(`  Avg duration:  ${formatDuration(stats.avgDurationMs)}`);
          console.log(`  Last run:      ${stats.lastRun ?? 'never'}`);
          return;
        }

        const runs = getRunHistory(opts.agent, parseInt(opts.limit));

        if (opts.json) {
          console.log(formatJson(runs));
          return;
        }

        if (runs.length === 0) {
          console.log('No runs recorded yet.');
          console.log(chalk.dim('Run an agent with: spacestation run <agent-name>'));
          return;
        }

        const table = new Table({
          head: ['AGENT', 'TRIGGER', 'STATUS', 'DURATION', 'STARTED'],
          style: { head: ['dim'] },
        });

        for (const run of runs) {
          const statusColor = run.status === 'success' ? chalk.green
            : run.status === 'error' ? chalk.red
            : run.status === 'timeout' ? chalk.yellow
            : chalk.blue;

          table.push([
            run.agentName,
            run.trigger,
            statusColor(run.status),
            run.durationMs != null ? formatDuration(run.durationMs) : '-',
            timeAgo(run.startedAt),
          ]);
        }

        console.log(table.toString());
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });
}

// timeAgo and formatDuration imported from formatters.ts
