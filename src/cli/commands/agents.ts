import { Command } from 'commander';
import { getPlatform } from '../../platform.js';
import { formatTable, formatAgentCard, formatJson } from '../formatters.js';

export function registerAgentCommands(program: Command): void {
  // agentbus ls
  program
    .command('ls')
    .description('List all registered agents')
    .option('-s, --status <status>', 'Filter by status (online, offline, sleeping, busy)')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const platform = await getPlatform();
      const agents = platform.registry.list(opts.status);

      if (opts.json) {
        console.log(formatJson(agents));
        return;
      }

      if (agents.length === 0) {
        console.log('No agents registered. Use "agentbus register" to add one.');
        return;
      }

      const rows = agents.map((a) => [
        a.name,
        a.status,
        a.capabilities.map((c) => c.name).join(', '),
        a.wakePatterns.join(', ') || '-',
        a.id.slice(0, 8),
      ]);

      console.log(
        formatTable(['Name', 'Status', 'Capabilities', 'Wake Patterns', 'ID'], rows),
      );
    });

  // agentbus register
  program
    .command('register')
    .description('Register a new agent')
    .requiredOption('-n, --name <name>', 'Agent name')
    .requiredOption('-d, --description <desc>', 'What the agent does')
    .option('-c, --capabilities <caps>', 'Comma-separated capabilities', '')
    .option('-w, --wake-on <patterns>', 'Comma-separated NATS subject patterns to wake on', '')
    .option('-e, --endpoint <url>', 'HTTP endpoint for direct communication')
    .option('-v, --version <ver>', 'Agent version', '0.1.0')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const platform = await getPlatform();

      try {
        const card = platform.registry.register({
          name: opts.name,
          description: opts.description,
          version: opts.version,
          capabilities: opts.capabilities
            ? opts.capabilities.split(',').map((s: string) => s.trim())
            : [],
          wakePatterns: opts.wakeOn
            ? opts.wakeOn.split(',').map((s: string) => s.trim())
            : [],
          endpoint: opts.endpoint,
        });

        platform.saveState();

        if (opts.json) {
          console.log(formatJson(card));
        } else {
          console.log(`Agent "${card.name}" registered (id: ${card.id})`);
          console.log(formatAgentCard(card));
          console.log('');
          console.log('Note: CLI-registered agents cannot respond to "agentbus ask" commands.');
          console.log('Use the SDK to create agents that handle messages.');
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // agentbus unregister
  program
    .command('unregister')
    .description('Remove an agent from the registry')
    .argument('<name-or-id>', 'Agent name or ID')
    .action(async (nameOrId) => {
      const platform = await getPlatform();
      const removed = platform.registry.unregister(nameOrId);

      if (removed) {
        platform.saveState();
        console.log(`Agent "${nameOrId}" unregistered.`);
      } else {
        console.error(`Agent "${nameOrId}" not found.`);
        process.exitCode = 1;
      }
    });

  // agentbus info
  program
    .command('info')
    .description('Show detailed info about an agent')
    .argument('<name-or-id>', 'Agent name or ID')
    .option('--json', 'Output as JSON')
    .action(async (nameOrId, opts) => {
      const platform = await getPlatform();
      const agent = platform.registry.resolve(nameOrId);

      if (!agent) {
        console.error(`Agent "${nameOrId}" not found.`);
        process.exitCode = 1;
        return;
      }

      if (opts.json) {
        console.log(formatJson(agent));
      } else {
        console.log(formatAgentCard(agent));
      }
    });

  // agentbus search
  program
    .command('search')
    .description('Search agents by capability or text query')
    .argument('<query>', 'Search query')
    .option('--capability', 'Search by exact capability name')
    .option('--json', 'Output as JSON')
    .action(async (query, opts) => {
      const platform = await getPlatform();
      const results = opts.capability
        ? platform.registry.findByCapability(query)
        : platform.registry.search(query);

      if (opts.json) {
        console.log(formatJson(results));
        return;
      }

      if (results.length === 0) {
        console.log(`No agents found matching "${query}".`);
        return;
      }

      const rows = results.map((a) => [
        a.name,
        a.status,
        a.capabilities.map((c) => c.name).join(', '),
        a.id.slice(0, 8),
      ]);

      console.log(formatTable(['Name', 'Status', 'Capabilities', 'ID'], rows));
    });
}
