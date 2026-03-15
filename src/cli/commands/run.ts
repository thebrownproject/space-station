import { Command } from 'commander';
import { resolve, join } from 'node:path';
import chalk from 'chalk';

export function registerRunCommand(program: Command): void {
  program.command('run')
    .description('Run an agent manually (one-shot, no daemon needed)')
    .argument('<agent-name>', 'Agent folder name')
    .option('--reason <text>', 'Why this run is happening', 'Manual run')
    .option('--skill <name>', 'Run a specific skill')
    .option('--model <model>', 'Claude model to use')
    .option('--timeout <seconds>', 'Max execution time in seconds', '3600')
    .option('--dir <path>', 'Agents directory', './agents')
    .action(async (agentName: string, opts) => {
      try {
        const { buildPrompt, runAgent } = await import('../../scheduler/index.js');
        const agentDir = resolve(join(opts.dir, agentName));
        const timeout = parseInt(opts.timeout, 10);

        console.log(`Running agent: ${chalk.bold(agentName)}`);
        console.log(`  Directory: ${agentDir}`);
        console.log(`  Reason:    ${opts.reason}`);
        if (opts.skill) console.log(`  Skill:     ${opts.skill}`);
        if (opts.model) console.log(`  Model:     ${opts.model}`);
        console.log(`  Timeout:   ${timeout}s`);
        console.log('');

        const prompt = await buildPrompt(agentDir, opts.reason, opts.skill);
        const startTime = Date.now();

        const result = await runAgent({
          agentDir,
          prompt,
          model: opts.model,
          timeout,
          onOutput: (data) => process.stdout.write(data),
          onError: (data) => process.stderr.write(data),
        });

        console.log('');
        console.log(chalk.dim('---'));
        console.log(`Exit code: ${result.exitCode === 0 ? chalk.green(result.exitCode) : chalk.red(result.exitCode)}`);
        console.log(`Duration:  ${formatDuration(result.durationMs)}`);
        if (result.timedOut) console.log(chalk.yellow('Timed out'));

        process.exitCode = result.exitCode;
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${remainSecs}s`;
}
