import { Command } from 'commander';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import chalk from 'chalk';

export function registerVerifyCommand(program: Command): void {
  program
    .command('verify')
    .description('Verify system health (database, agents, skills, CLI)')
    .option('--agents <dir>', 'Agents directory', './agents')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const checks: Array<{ name: string; status: 'pass' | 'fail' | 'warn'; message: string }> = [];

      // 1. Database
      try {
        const { runMigrations } = await import('../../db/migrate.js');
        const { listNodes } = await import('../../db/queries.js');
        runMigrations();
        const roots = listNodes({ depth: 0, limit: 100 });
        checks.push({
          name: 'Database',
          status: 'pass',
          message: `SQLite connected, ${roots.length} root nodes`,
        });
      } catch (err) {
        checks.push({
          name: 'Database',
          status: 'fail',
          message: err instanceof Error ? err.message : 'Failed to connect',
        });
      }

      // 2. Agent folders
      const agentsDir = resolve(opts.agents);
      if (existsSync(agentsDir)) {
        try {
          const { AgentLoader } = await import('../../agents/agent-loader.js');
          const loader = new AgentLoader();
          const manifests = await loader.discoverAgents(agentsDir);
          checks.push({
            name: 'Agent Folders',
            status: manifests.length > 0 ? 'pass' : 'warn',
            message: `${manifests.length} agent(s) found in ${opts.agents}/`,
          });

          // Validate each agent
          for (const m of manifests) {
            try {
              await loader.loadManifest(m.folderPath);
              checks.push({
                name: `  Agent: ${m.config.name}`,
                status: 'pass',
                message: `${m.cronConfig?.jobs?.length ?? 0} cron, ${m.skills.length} skills`,
              });
            } catch (err) {
              checks.push({
                name: `  Agent: ${m.config.name}`,
                status: 'fail',
                message: err instanceof Error ? err.message : 'Invalid config',
              });
            }
          }
        } catch (err) {
          checks.push({
            name: 'Agent Folders',
            status: 'fail',
            message: err instanceof Error ? err.message : 'Failed to load',
          });
        }
      } else {
        checks.push({
          name: 'Agent Folders',
          status: 'warn',
          message: `${opts.agents}/ directory not found`,
        });
      }

      // 3. Shared skills
      const skillsDir = resolve('skills');
      if (existsSync(skillsDir)) {
        try {
          const { SkillLoader } = await import('../../skills/skill-loader.js');
          const loader = new SkillLoader();
          const skills = await loader.discoverSkills(skillsDir, 'shared');
          checks.push({
            name: 'Shared Skills',
            status: skills.length > 0 ? 'pass' : 'warn',
            message: `${skills.length} shared skill(s)`,
          });
        } catch (err) {
          checks.push({
            name: 'Shared Skills',
            status: 'fail',
            message: err instanceof Error ? err.message : 'Failed to load',
          });
        }
      } else {
        checks.push({
          name: 'Shared Skills',
          status: 'warn',
          message: 'No skills/ directory',
        });
      }

      // 4. Claude CLI
      try {
        const version = execSync('claude --version 2>&1', { timeout: 5000 }).toString().trim();
        checks.push({
          name: 'Claude CLI',
          status: 'pass',
          message: `claude ${version}`,
        });
      } catch {
        checks.push({
          name: 'Claude CLI',
          status: 'warn',
          message: 'Not found (agents cannot be spawned without it)',
        });
      }

      // 5. Webhooks
      const webhooksPath = resolve('webhooks.yaml');
      if (existsSync(webhooksPath)) {
        checks.push({
          name: 'Webhooks',
          status: 'pass',
          message: 'webhooks.yaml found',
        });
      } else {
        checks.push({
          name: 'Webhooks',
          status: 'warn',
          message: 'No webhooks.yaml (notifications disabled)',
        });
      }

      // Output
      if (opts.json) {
        console.log(JSON.stringify(checks, null, 2));
        return;
      }

      console.log('');
      console.log(chalk.bold('  SYSTEM VERIFICATION'));
      console.log(chalk.dim('  ' + '='.repeat(35)));
      console.log('');

      const icons = { pass: chalk.green('✓'), fail: chalk.red('✗'), warn: chalk.yellow('!') };

      for (const check of checks) {
        console.log(`  ${icons[check.status]} ${check.name.padEnd(22)} ${chalk.dim(check.message)}`);
      }

      const passes = checks.filter(c => c.status === 'pass').length;
      const fails = checks.filter(c => c.status === 'fail').length;
      const warns = checks.filter(c => c.status === 'warn').length;

      console.log('');
      console.log(`  ${chalk.dim('Result:')} ${chalk.green(passes + ' pass')} ${warns > 0 ? chalk.yellow(warns + ' warn') : ''} ${fails > 0 ? chalk.red(fails + ' fail') : ''}`);
      console.log('');

      if (fails > 0) process.exitCode = 1;
    });
}
