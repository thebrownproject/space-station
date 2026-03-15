import type { Command } from 'commander';
import { registerAgentCommands } from './agents.js';
import { registerBusCommands } from './bus.js';
import { registerMemoryCommands } from './memory.js';
import { registerWakeCommands } from './wake.js';
import { registerStatusCommand } from './status.js';
import { registerSkillsCommands } from './skills.js';

export function registerCommands(program: Command): void {
  registerAgentCommands(program);
  registerBusCommands(program);
  registerMemoryCommands(program);
  registerWakeCommands(program);
  registerStatusCommand(program);
  registerSkillsCommands(program);
}
