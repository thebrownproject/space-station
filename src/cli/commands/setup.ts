import { Command } from 'commander';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import chalk from 'chalk';

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Bootstrap the workspace (seed database, load agents, show status)')
    .option('--agents <dir>', 'Agents directory', './agents')
    .action(async (opts) => {
      console.log('');
      console.log(chalk.bold('  SPACE STATION SETUP'));
      console.log(chalk.dim('  ' + '='.repeat(30)));
      console.log('');

      // Step 1: Initialize database with default spaces
      try {
        const { runMigrations } = await import('../../db/migrate.js');
        const { createNode, getNodeByPath } = await import('../../db/queries.js');
        runMigrations();
        console.log(`  ${chalk.green('✓')} Database initialized`);

        const defaults = ['Engineering', 'Career', 'Life', 'Agents'];
        let created = 0;
        for (const title of defaults) {
          if (!getNodeByPath(title.toLowerCase())) {
            createNode({ type: 'space', title });
            created++;
          }
        }
        if (created > 0) {
          console.log(`  ${chalk.green('✓')} Created ${created} default spaces`);
        } else {
          console.log(`  ${chalk.dim('-')} Default spaces already exist`);
        }
      } catch (err) {
        console.log(`  ${chalk.red('✗')} Database error: ${err instanceof Error ? err.message : err}`);
      }

      // Step 2: Load agents
      const agentsDir = resolve(opts.agents);
      if (existsSync(agentsDir)) {
        try {
          const { AgentLoader } = await import('../../agents/agent-loader.js');
          const loader = new AgentLoader();
          const manifests = await loader.discoverAgents(agentsDir);
          console.log(`  ${chalk.green('✓')} Found ${manifests.length} agents in ${opts.agents}/`);
          for (const m of manifests) {
            const cronCount = m.cronConfig?.jobs?.length ?? 0;
            const skillCount = m.skills.length;
            console.log(`      ${chalk.cyan(m.config.name.padEnd(20))} ${cronCount} cron, ${skillCount} skills`);
          }
        } catch (err) {
          console.log(`  ${chalk.red('✗')} Agent loading error: ${err instanceof Error ? err.message : err}`);
        }
      } else {
        console.log(`  ${chalk.dim('-')} No agents/ directory found`);
      }

      // Step 3: Load shared skills
      const skillsDir = resolve('skills');
      if (existsSync(skillsDir)) {
        try {
          const { SkillLoader } = await import('../../skills/skill-loader.js');
          const loader = new SkillLoader();
          const skills = await loader.discoverSkills(skillsDir, 'shared');
          console.log(`  ${chalk.green('✓')} Found ${skills.length} shared skills`);
        } catch (err) {
          console.log(`  ${chalk.dim('-')} No shared skills found`);
        }
      }

      // Step 4: Show quick stats
      try {
        const { listNodes } = await import('../../db/queries.js');
        const types = ['space', 'post', 'task', 'page', 'comment', 'report'] as const;
        let total = 0;
        for (const type of types) {
          total += listNodes({ type, limit: 100000 }).length;
        }
        console.log(`  ${chalk.green('✓')} Database has ${total} nodes`);
      } catch {
        // ignore
      }

      console.log('');
      console.log(chalk.dim('  Ready! Try:'));
      console.log(chalk.dim('    spacestation node dashboard'));
      console.log(chalk.dim('    spacestation node tree'));
      console.log(chalk.dim('    spacestation run <agent-name>'));
      console.log('');
    });
}
