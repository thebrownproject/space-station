#!/usr/bin/env node

import { Command } from 'commander';
import { registerCommands } from './commands/index.js';

const program = new Command();

program
  .name('spacestation')
  .description('Agent Message Bus — discover, communicate, wake, and remember across AI agents')
  .version('0.1.0');

registerCommands(program);

program.parse();
