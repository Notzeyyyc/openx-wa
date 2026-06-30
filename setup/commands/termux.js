import { Command } from 'commander';

export const termuxCommand = new Command('termux')
  .description('Show Termux setup instructions')
  .action(() => {
    console.log(`
=== OpenXX Termux Setup ===

One-click install:
  pkg install curl -y && curl -sL https://raw.githubusercontent.com/Notzeyyyc/openx-wa/main/scripts/termux-setup.sh | sh

This installs:
  - Node.js, Go, Git, tmux, Android tools
  - pnpm, pm2 (process manager)
  - OpenXX project + MCP server
  - Auto-start on boot (Termux:Boot)

After install, use the openxx command:
  openxx            — interactive menu
  openxx start      — start all services
  openxx stop       — stop all services
  openxx restart    — restart all services
  openxx status     — check status
  openxx logs       — view bot logs
  openxx logs-mcp   — view MCP logs
  openxx update     — git pull + rebuild

Manual setup:
  1. pkg install nodejs-lts golang git tmux android-tools
  2. npm install -g pm2
  3. git clone https://github.com/Notzeyyyc/openx-wa.git ~/openxx
  4. cd ~/openxx && pnpm install
  5. cd openx-mcp && go build -o openx-mcp .
  6. cp .env.example .env && nano .env
  7. pm2 start index.js --name openxx-bot
  8. pm2 start ./openx-mcp --name openxx-mcp --cwd ~/openxx/openx-mcp
  9. pm2 save && pm2 startup

Process management (pm2):
  pm2 status              — list all processes
  pm2 logs                — view all logs
  pm2 restart all         — restart everything
  pm2 monit               — real-time monitor
  pm2 save                — save process list
  pm2 resurrect           — restore saved processes

Keep alive:
  termux-wake-lock        — prevent CPU sleep
  Settings > Apps > Termux > Battery > Unrestricted
  Install Termux:Boot from F-Droid for auto-start
`);
  });
