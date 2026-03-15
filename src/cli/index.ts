#!/usr/bin/env node

import { Command } from 'commander';
import { registerCommands } from './commands/index.js';

const program = new Command();

program
  .name('spacestation')
  .description('Multi-agent workspace — agents coordinate through a shared database, scheduled via cron, invoked as Claude Code sessions')
  .version('0.3.0');

registerCommands(program);

program.parse();
