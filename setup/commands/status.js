import { Command } from 'commander';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export const statusCommand = new Command('status')
  .description('Check deployment status')
  .action(async () => {
    console.log('\n=== OpenXX Status ===\n');

    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) {
      console.log('❌ .env not found — run: openxx-setup init');
      return;
    }

    const env = fs.readFileSync(envPath, 'utf-8');
    const getEnv = (key) => {
      const match = env.match(new RegExp(`^${key}=(.*)$`, 'm'));
      return match ? match[1].trim() : '';
    };

    const provider = getEnv('OPENX_AI_PROVIDER');
    const model = getEnv('OPENX_OPENAI_MODEL') || getEnv('OPENX_REST_MODEL') || 'unknown';
    console.log(`AI Provider: ${provider || 'not set'} (${model})`);

    const adbPort = getEnv('OPENX_ADB_PORT');
    console.log(`ADB Mode: ${adbPort || 'not set'}`);
    if (adbPort === 'usb') {
      try {
        const output = execSync('adb devices 2>&1', { encoding: 'utf-8' });
        const devices = output.trim().split('\n').slice(1).filter(l => l.includes('\tdevice'));
        if (devices.length > 0) {
          console.log(`  ✓ USB device: ${devices[0].split('\t')[0]}`);
        } else {
          console.log('  ✗ No USB device found');
        }
      } catch {
        console.log('  ✗ ADB not available');
      }
    }

    const mcpUrl = getEnv('OPENX_MCP_URL');
    console.log(`MCP Server: ${mcpUrl || 'not set'}`);
    if (mcpUrl) {
      try {
        const res = await fetch(mcpUrl, { signal: AbortSignal.timeout(3000) });
        console.log(`  ✓ Reachable (${res.status})`);
      } catch {
        console.log('  ✗ Not reachable');
      }
    }

    const token = getEnv('OPENX_MCP_API_KEY');
    console.log(`Auth Token: ${token ? '✓ set' : '✗ not set'}`);

    console.log('');
  });
