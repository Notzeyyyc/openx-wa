import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const CACHE_DIR = path.join(ROOT, 'caches');
export const LOG_FILE = path.join(ROOT, 'log.txt');
export const ENV_FILE = path.join(ROOT, '.env');
export const CONV_DIR = path.join(DATA_DIR, 'conversations');
export const STORAGE_DIR = path.join(DATA_DIR, 'storage');
