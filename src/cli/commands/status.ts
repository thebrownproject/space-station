import { Command } from 'commander';
import { getPlatform } from '../../platform.js';
import { formatJson } from '../formatters.js';

async function getNodeStats(): Promise<{ total: number; byType: Record<string, number>; byStatus: Record<string, number> } | null> {
  try {
    const { getDb } = await import('../../db/connection.js');
    const { sql } = await import('drizzle-orm');
    const db = getDb();
    const rows = db.all(sql`SELECT type, status, COUNT(*) as count FROM nodes GROUP BY type, status`);
    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of rows as Array<{ type: string; status: string | null; count: number }>) {
      byType[row.type] = (byType[row.type] ?? 0) + row.count;
      if (row.status) byStatus[row.status] = (byStatus[row.status] ?? 0) + row.count;
      total += row.count;
    }
    return { total, byType, byStatus };
  } catch {
    return null;
  }
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show platform status and statistics')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const platform = await getPlatform();

      const registryStats = platform.registry.stats();
      const busStats = platform.bus.stats();
      const memoryStats = platform.memory.stats();
      const nodeStats = await getNodeStats();

      const status = {
        registry: registryStats,
        bus: busStats,
        memory: memoryStats,
        nodes: nodeStats,
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

      console.log('Space Station Platform Status');
      console.log('==============================');
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

      if (nodeStats) {
        console.log('');
        console.log('Nodes Database:');
        console.log(`  Total nodes: ${nodeStats.total}`);
        const typeEntries = Object.entries(nodeStats.byType).map(([k, v]) => `${k}: ${v}`).join('  ');
        if (typeEntries) console.log(`  By type:   ${typeEntries}`);
        const statusEntries = Object.entries(nodeStats.byStatus).map(([k, v]) => `${k}: ${v}`).join('  ');
        if (statusEntries) console.log(`  By status: ${statusEntries}`);
      }
    });
}
