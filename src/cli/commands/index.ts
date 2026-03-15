import type { Command } from 'commander';
import { registerAgentCommands } from './agents.js';
import { registerBusCommands } from './bus.js';
import { registerMemoryCommands } from './memory.js';
import { registerWakeCommands } from './wake.js';
import { registerStatusCommand } from './status.js';
import { registerSkillsCommands } from './skills.js';
import { registerNodeCommands } from './node.js';
import { registerDaemonCommands } from './daemon.js';
import { registerRunCommand } from './run.js';
import { registerSetupCommand } from './setup.js';
import { registerVerifyCommand } from './verify.js';
import { registerRunsCommand } from './runs.js';

export function registerCommands(program: Command): void {
  registerAgentCommands(program);
  registerBusCommands(program);
  registerMemoryCommands(program);
  registerWakeCommands(program);
  registerStatusCommand(program);
  registerSkillsCommands(program);
  registerNodeCommands(program);
  registerDaemonCommands(program);
  registerRunCommand(program);
  registerSetupCommand(program);
  registerVerifyCommand(program);
  registerRunsCommand(program);
}
