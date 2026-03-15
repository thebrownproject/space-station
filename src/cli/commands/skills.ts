import { Command } from 'commander';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { SkillRegistry } from '../../skills/index.js';
import { formatTable, formatJson } from '../formatters.js';

/** Build a registry with skills discovered from conventional paths. */
async function loadRegistry(): Promise<SkillRegistry> {
  const registry = new SkillRegistry();
  const searchPaths: Array<{ path: string; source: 'agent' | 'shared' | 'global'; agentName?: string }> = [
    { path: resolve('skills'), source: 'shared' },
    { path: resolve(homedir(), '.agentbus', 'skills'), source: 'global' },
  ];

  // Discover agent-specific skills by scanning agents/ for subdirs with skills/
  const { readdir, access } = await import('node:fs/promises');
  const agentsDir = resolve('agents');
  try {
    await access(agentsDir);
    const entries = await readdir(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillsPath = resolve(agentsDir, entry.name, 'skills');
      try {
        await access(skillsPath);
        searchPaths.push({ path: skillsPath, source: 'agent', agentName: entry.name });
      } catch {
        // no skills/ dir for this agent
      }
    }
  } catch {
    // no agents/ dir
  }

  await registry.discoverSkills(searchPaths);
  await registry.loadAll();
  return registry;
}

import type { Skill } from '../../skills/skill-types.js';

function skillRow(s: Skill): string[] {
  return [s.name, s.description, s.version, s.source, s.agentName ?? '-', (s.tags ?? []).join(', ') || '-'];
}

const SKILL_HEADERS = ['Name', 'Description', 'Version', 'Source', 'Agent', 'Tags'];

export function registerSkillsCommands(program: Command): void {
  const skills = program.command('skills').description('Skills management');

  skills
    .command('list')
    .description('List available skills')
    .option('-a, --agent <name>', 'Show skills available to specific agent')
    .option('--source <source>', 'Filter by source: agent|shared|global')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      try {
        const registry = await loadRegistry();
        let results = registry.list(opts.agent);

        if (opts.source) {
          results = results.filter((s) => s.source === opts.source);
        }

        if (opts.json) {
          console.log(formatJson(results));
          return;
        }

        if (results.length === 0) {
          console.log('No skills found.');
          return;
        }

        console.log(formatTable(SKILL_HEADERS, results.map(skillRow)));
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  skills
    .command('info <skill-name>')
    .description('Show detailed skill information')
    .option('--json', 'Output as JSON')
    .action(async (skillName: string, opts) => {
      try {
        const registry = await loadRegistry();
        // Try exact key first, then fallback to searching by id across all skills
        let skill = registry.get(skillName);
        if (!skill) {
          skill = registry.list().find((s) => s.id === skillName);
        }

        if (!skill) {
          console.error(`Skill "${skillName}" not found.`);
          process.exitCode = 1;
          return;
        }

        if (opts.json) {
          console.log(formatJson(skill));
          return;
        }

        const lines = [
          `Skill: ${skill.name}`,
          `  ID:            ${skill.id}`,
          `  Description:   ${skill.description}`,
          `  Version:       ${skill.version}`,
          `  Source:        ${skill.source}`,
          `  Agent:         ${skill.agentName ?? '-'}`,
          `  User-invocable: ${skill.userInvocable}`,
          `  File:          ${skill.filePath}`,
        ];
        if (skill.allowedTools?.length) {
          lines.push(`  Allowed tools: ${skill.allowedTools.join(', ')}`);
        }
        if (skill.tags?.length) {
          lines.push(`  Tags:          ${skill.tags.join(', ')}`);
        }
        lines.push('', '--- Content ---', '', skill.content);
        console.log(lines.join('\n'));
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  skills
    .command('search <query>')
    .description('Search skills by name, description, or tags')
    .option('--json', 'Output as JSON')
    .action(async (query: string, opts) => {
      try {
        const registry = await loadRegistry();
        const results = registry.search(query);

        if (opts.json) {
          console.log(formatJson(results));
          return;
        }

        if (results.length === 0) {
          console.log(`No skills found matching "${query}".`);
          return;
        }

        console.log(formatTable(SKILL_HEADERS, results.map(skillRow)));
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });
}
