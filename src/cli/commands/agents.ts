import { Command } from 'commander';
import { join, resolve } from 'node:path';
import { access } from 'node:fs/promises';
import { getPlatform } from '../../platform.js';
import { AgentLoader } from '../../agents/index.js';
import type { AgentManifest, AgentLoadResult } from '../../agents/index.js';
import { formatTable, formatAgentCard, formatJson } from '../formatters.js';

/** Map template name to the files it creates (for checkmark output). */
const TEMPLATE_FILES: Record<string, string[]> = {
  basic: ['agent.yaml'],
  full: ['agent.yaml', 'CLAUDE.md', 'SOUL.md', 'IDENTITY.md', 'skills/', 'memory/'],
  cron: ['agent.yaml', 'CLAUDE.md', 'cron.yaml'],
};

/** Build an AgentLoadResult from a manifest (no platform registration yet). */
function manifestToLoadResult(manifest: AgentManifest): AgentLoadResult {
  const warnings: string[] = [];
  if (manifest.identityFiles.soul !== undefined && manifest.identityFiles.soul.trim() === '') {
    warnings.push(`${manifest.config.name}: SOUL.md is empty`);
  }
  return {
    manifest,
    agentId: '',
    agentName: manifest.config.name,
    cronJobsLoaded: manifest.cronConfig?.jobs.length ?? 0,
    skillsLoaded: manifest.skills.length,
    warnings,
  };
}

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

  // spacestation init <name>
  program
    .command('init')
    .description('Create a new agent folder')
    .argument('<name>', 'Agent name')
    .option('-d, --dir <path>', 'Parent directory', './agents')
    .option('-t, --template <type>', 'Template: basic | full | cron', 'basic')
    .action(async (name: string, opts) => {
      try {
        const loader = new AgentLoader();
        const folderPath = await loader.initAgent(opts.dir, name, opts.template);
        const files = TEMPLATE_FILES[opts.template] ?? TEMPLATE_FILES.basic;
        const relative = folderPath.replace(resolve('.') + '/', '');
        console.log(`Created agent folder: ${relative}/`);
        for (const file of files) {
          console.log(`  ${file.padEnd(14)}\u2713`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // spacestation load <path>
  program
    .command('load')
    .description('Load agent(s) from folder(s)')
    .argument('<path>', 'Agent folder or directory of agent folders')
    .option('--json', 'Output as JSON')
    .action(async (targetPath: string, opts) => {
      try {
        const loader = new AgentLoader();
        const resolved = resolve(targetPath);
        let manifests: AgentManifest[];

        // Single agent folder (has agent.yaml) vs directory of agents
        const agentYaml = join(resolved, 'agent.yaml');
        let isSingleAgent = false;
        try {
          await access(agentYaml);
          isSingleAgent = true;
        } catch {
          // not a single agent folder
        }

        if (isSingleAgent) {
          manifests = [await loader.loadManifest(resolved)];
        } else {
          manifests = await loader.discoverAgents(resolved);
        }

        if (manifests.length === 0) {
          console.log('No agent folders found.');
          return;
        }

        const results = manifests.map(manifestToLoadResult);
        const warnings = results.flatMap((r) => r.warnings);

        if (opts.json) {
          console.log(formatJson(results));
          return;
        }

        console.log(`Loaded ${manifests.length} agent${manifests.length === 1 ? '' : 's'}:`);
        for (const r of results) {
          const cronLabel = r.cronJobsLoaded === 1 ? '1 cron job' : `${r.cronJobsLoaded} cron jobs`;
          const skillLabel = r.skillsLoaded === 1 ? '1 skill' : `${r.skillsLoaded} skills`;
          console.log(`  ${r.agentName.padEnd(16)} ${cronLabel}, ${skillLabel}`);
        }

        if (warnings.length > 0) {
          console.log('');
          console.log('Warnings:');
          for (const w of warnings) {
            console.log(`  ${w}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });
}
