#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { tunnelCommand } from './commands/tunnel.js';
import { statusCommand } from './commands/status.js';

const program = new Command();

program
  .name('openxx-setup')
  .description('OpenXX deployment setup tool')
  .version('1.0.0');

program.addCommand(initCommand);
program.addCommand(tunnelCommand);
program.addCommand(statusCommand);

program.parse();
