import { Command } from 'commander';
import { getPlatform } from '../../platform.js';
import { formatTable, formatJson } from '../formatters.js';

export function registerMemoryCommands(program: Command): void {
  const mem = program
    .command('memory')
    .description('Manage shared memory across agents');

  // agentbus memory set
  mem
    .command('set')
    .description('Store a value in memory')
    .argument('<key>', 'Memory key')
    .argument('<value>', 'Value (JSON string or plain text)')
    .option('-s, --scope <scope>', 'Memory scope: agent, shared, session', 'shared')
    .option('-a, --agent <id>', 'Agent ID (for agent-scoped memory)')
    .option('--session <id>', 'Session ID (for session-scoped memory)')
    .option('-t, --tags <tags>', 'Comma-separated tags', '')
    .option('--ttl <seconds>', 'Time-to-live in seconds (0 = never)', '0')
    .option('--json', 'Output as JSON')
    .action(async (key, value, opts) => {
      const platform = await getPlatform();

      let parsedValue: unknown;
      try {
        parsedValue = JSON.parse(value);
      } catch {
        parsedValue = value;
      }

      const entry = platform.memory.set(key, parsedValue, {
        scope: opts.scope,
        agentId: opts.agent,
        sessionId: opts.session,
        tags: opts.tags ? opts.tags.split(',').map((s: string) => s.trim()) : [],
        ttl: parseInt(opts.ttl, 10),
      });

      platform.saveState();

      if (opts.json) {
        console.log(formatJson(entry));
      } else {
        console.log(`Memory set: ${key} = ${JSON.stringify(parsedValue)} [${opts.scope}]`);
      }
    });

  // agentbus memory get
  mem
    .command('get')
    .description('Retrieve a value from memory')
    .argument('<key>', 'Memory key')
    .option('-s, --scope <scope>', 'Memory scope', 'shared')
    .option('-a, --agent <id>', 'Agent ID')
    .option('--session <id>', 'Session ID')
    .option('--json', 'Output as JSON')
    .action(async (key, opts) => {
      const platform = await getPlatform();

      const entry = platform.memory.get(key, {
        scope: opts.scope,
        agentId: opts.agent,
        sessionId: opts.session,
      });

      if (!entry) {
        console.log(`No memory found for key "${key}" in ${opts.scope} scope.`);
        process.exitCode = 1;
        return;
      }

      if (opts.json) {
        console.log(formatJson(entry));
      } else {
        console.log(`${entry.key} = ${JSON.stringify(entry.value)}`);
        console.log(`  scope: ${entry.scope}, tags: [${entry.tags.join(', ')}]`);
        console.log(`  updated: ${entry.updatedAt}`);
      }
    });

  // agentbus memory search
  mem
    .command('search')
    .description('Search memory entries')
    .argument('<query>', 'Text search query')
    .option('-s, --scope <scope>', 'Filter by scope')
    .option('-a, --agent <id>', 'Filter by agent')
    .option('-t, --tags <tags>', 'Filter by tags (comma-separated)')
    .option('-n, --limit <n>', 'Max results', '20')
    .option('--json', 'Output as JSON')
    .action(async (query, opts) => {
      const platform = await getPlatform();

      const results = platform.memory.query({
        search: query,
        scope: opts.scope,
        agentId: opts.agent,
        tags: opts.tags ? opts.tags.split(',').map((s: string) => s.trim()) : undefined,
        limit: parseInt(opts.limit, 10),
      });

      if (opts.json) {
        console.log(formatJson(results));
        return;
      }

      if (results.length === 0) {
        console.log(`No memory entries matching "${query}".`);
        return;
      }

      const rows = results.map((e) => [
        e.key,
        JSON.stringify(e.value).slice(0, 50),
        e.scope,
        e.tags.join(', ') || '-',
        e.agentId?.slice(0, 8) ?? '-',
      ]);

      console.log(formatTable(['Key', 'Value', 'Scope', 'Tags', 'Agent'], rows));
    });

  // agentbus memory delete
  mem
    .command('delete')
    .description('Delete a memory entry')
    .argument('<key>', 'Memory key')
    .option('-s, --scope <scope>', 'Memory scope', 'shared')
    .option('-a, --agent <id>', 'Agent ID')
    .option('--session <id>', 'Session ID')
    .action(async (key, opts) => {
      const platform = await getPlatform();

      const deleted = platform.memory.delete(key, {
        scope: opts.scope,
        agentId: opts.agent,
        sessionId: opts.session,
      });

      if (deleted) {
        platform.saveState();
        console.log(`Memory entry "${key}" deleted.`);
      } else {
        console.log(`No memory entry found for key "${key}".`);
        process.exitCode = 1;
      }
    });

  // agentbus memory stats
  mem
    .command('stats')
    .description('Show memory statistics')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const platform = await getPlatform();
      const stats = platform.memory.stats();

      if (opts.json) {
        console.log(formatJson(stats));
        return;
      }

      console.log(`Total entries: ${stats.totalEntries}`);
      console.log(`By scope:`);
      for (const [scope, count] of Object.entries(stats.byScope)) {
        console.log(`  ${scope}: ${count}`);
      }
      if (Object.keys(stats.byAgent).length > 0) {
        console.log(`By agent:`);
        for (const [agent, count] of Object.entries(stats.byAgent)) {
          console.log(`  ${agent.slice(0, 8)}: ${count}`);
        }
      }
    });
}
