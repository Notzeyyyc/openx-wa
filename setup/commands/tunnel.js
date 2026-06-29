import { Command } from 'commander';
import prompts from 'prompts';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export const tunnelCommand = new Command('tunnel')
  .description('Setup tunnel for VPS ↔ Android connection')
  .action(async () => {
    const response = await prompts({
      type: 'select',
      name: 'type',
      message: 'Tunnel type?',
      choices: [
        { title: 'Cloudflared (recommended, free)', value: 'cloudflared' },
        { title: 'Tailscale (VPN, P2P direct)', value: 'tailscale' },
        { title: 'Skip (manual setup)', value: 'skip' }
      ]
    });

    if (response.cancelled || response.type === 'skip') return;

    if (response.type === 'cloudflared') {
      console.log('\n=== Cloudflared Setup ===\n');
      console.log('Run this on your Android (Termux):\n');
      console.log('  pkg install cloudflared');
      console.log('  cloudflared tunnel --url http://localhost:8765\n');
      console.log('Copy the public URL (https://xxxx.trycloudflare.com)');
      console.log('and set OPENX_MCP_URL in your VPS .env\n');

      const urlResponse = await prompts({
        type: 'text',
        name: 'url',
        message: 'Paste the cloudflared URL (or press Enter to skip):',
      });

      if (urlResponse.url) {
        const envPath = path.resolve(process.cwd(), '.env');
        let env = fs.readFileSync(envPath, 'utf-8');
        env = env.replace(/^OPENX_MCP_URL=.*/m, `OPENX_MCP_URL=${urlResponse.url}`);
        fs.writeFileSync(envPath, env);
        console.log(`\n✅ Updated OPENX_MCP_URL in .env`);
      }
    }

    if (response.type === 'tailscale') {
      console.log('\n=== Tailscale Setup ===\n');
      console.log('1. Install Tailscale on both VPS and Android (Termux):');
      console.log('   VPS: curl -fsSL https://tailscale.com/install.sh | sh');
      console.log('   Termux: pkg install tailscale');
      console.log('');
      console.log('2. Login with the same account on both devices');
      console.log('');
      console.log('3. Find Android Tailscale IP:');
      console.log('   tailscale ip -4');

      const ipResponse = await prompts({
        type: 'text',
        name: 'ip',
        message: 'Android Tailscale IP (e.g. 100.x.x.x):',
      });

      if (ipResponse.ip) {
        const envPath = path.resolve(process.cwd(), '.env');
        let env = fs.readFileSync(envPath, 'utf-8');
        env = env.replace(/^OPENX_MCP_URL=.*/m, `OPENX_MCP_URL=http://${ipResponse.ip}:8765`);
        fs.writeFileSync(envPath, env);
        console.log(`\n✅ Updated OPENX_MCP_URL in .env`);
      }
    }
  });
