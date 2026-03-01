import { Command } from 'commander';
import { getPlatform } from '../../platform.js';
import { formatTable, formatJson } from '../formatters.js';

export function registerWakeCommands(program: Command): void {
  // agentbus wake
  program
    .command('wake')
    .description('Manually wake an agent')
    .argument('<agent>', 'Agent name or ID')
    .option('-r, --reason <reason>', 'Reason for waking', 'Manual wake from CLI')
    .option('--json', 'Output as JSON')
    .action(async (agent, opts) => {
      const platform = getPlatform();

      try {
        const event = await platform.wake.wake(agent, opts.reason);

        if (opts.json) {
          console.log(formatJson(event));
        } else {
          console.log(`Woke "${event.agentName}" — ${event.reason}`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // agentbus wake-log
  program
    .command('wake-log')
    .description('Show wake event history')
    .option('-a, --agent <name>', 'Filter by agent')
    .option('-n, --limit <n>', 'Number of events to show', '20')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      const platform = getPlatform();

      const agentId = opts.agent
        ? platform.registry.resolve(opts.agent)?.id
        : undefined;

      const events = platform.wake.getLog(agentId, parseInt(opts.limit, 10));

      if (opts.json) {
        console.log(formatJson(events));
        return;
      }

      if (events.length === 0) {
        console.log('No wake events recorded.');
        return;
      }

      const rows = events.map((e) => [
        new Date(e.timestamp).toLocaleTimeString(),
        e.agentName,
        e.reason,
      ]);

      console.log(formatTable(['Time', 'Agent', 'Reason'], rows));
    });
}
