import { Command } from 'commander';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export const termuxCommand = new Command('termux')
  .description('Show Termux setup instructions')
  .action(() => {
    console.log(`
=== OpenXX Termux Setup ===

Run this one-liner on your Android (Termux):

  pkg install curl -y && curl -sL raw.githubusercontent.com/Notzeyyyc/openx-wa/main/scripts/termux-setup.sh | sh

Or manual setup:

  1. Install dependencies:
     pkg install nodejs-lts golang git tmux

  2. Clone project:
     git clone https://github.com/Notzeyyyc/openx-wa.git ~/openxx
     cd ~/openxx

  3. Install npm packages:
     pnpm install

  4. Build MCP server:
     cd openx-mcp && go build -o openx-mcp . && cd ..

  5. Configure:
     cp .env.example .env && nano .env

  6. Start with tmux:
     tmux new -s openxx
     pnpm start
     # Press Ctrl+B then D to detach

  7. Auto-start on boot:
     Install Termux:Boot from F-Droid
     mkdir -p ~/.termux/boot
     # Copy scripts/termux-setup.sh content to ~/.termux/boot/openxx.sh
     chmod +x ~/.termux/boot/openxx.sh

Useful commands:
  tmux ls                  — list sessions
  tmux attach -t openxx    — attach to bot
  tmux kill-session -t openxx — stop bot
`);
  });
