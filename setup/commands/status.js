import { Command } from 'commander';
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

    const baseUrl = getEnv('OPENX_OPENAI_BASE_URL');
    const model = getEnv('OPENX_OPENAI_MODEL') || 'unknown';
    const apiKey = getEnv('OPENX_OPENAI_API_KEY');
    console.log(`AI: ${baseUrl} (${model}) ${apiKey ? '✓ key set' : '✗ no key'}`);

    const phone = getEnv('OPENX_DEV_PHONE_NUMBER');
    console.log(`Admin phone: ${phone || 'not set'}`);

    console.log('');
  });
