import { Command } from 'commander';
import { getPlatform } from '../../platform.js';
import { formatJson } from '../formatters.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show platform status and statistics')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      const platform = getPlatform();

      const registryStats = platform.registry.stats();
      const busStats = platform.bus.stats();
      const memoryStats = platform.memory.stats();

      const status = {
        registry: registryStats,
        bus: busStats,
        memory: memoryStats,
        config: {
          embedded: platform.config.embedded,
          natsUrl: platform.config.natsUrl ?? 'N/A (embedded mode)',
          dataDir: platform.config.dataDir,
        },
      };

      if (opts.json) {
        console.log(formatJson(status));
        return;
      }

      console.log('AgentBus Platform Status');
      console.log('========================');
      console.log('');
      console.log(`Mode:     ${platform.config.embedded ? 'Embedded (in-process)' : 'NATS'}`);
      console.log(`Data dir: ${platform.config.dataDir}`);
      console.log('');
      console.log('Registry:');
      console.log(`  Total agents: ${registryStats.total}`);
      console.log(`  Online: ${registryStats.byStatus.online}  Sleeping: ${registryStats.byStatus.sleeping}  Offline: ${registryStats.byStatus.offline}  Busy: ${registryStats.byStatus.busy}`);
      console.log('');
      console.log('Message Bus:');
      console.log(`  Total messages:       ${busStats.totalMessages}`);
      console.log(`  Active subscriptions: ${busStats.activeSubscriptions}`);
      console.log(`  Pending requests:     ${busStats.pendingRequests}`);
      console.log('');
      console.log('Memory:');
      console.log(`  Total entries: ${memoryStats.totalEntries}`);
      console.log(`  Shared: ${memoryStats.byScope.shared}  Agent: ${memoryStats.byScope.agent}  Session: ${memoryStats.byScope.session}`);
    });
}
