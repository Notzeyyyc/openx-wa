/**
 * scripts/scan-secrets.mjs
 * Simple secret scanner to prevent accidental commits.
 *
 * Usage:
 *   node scripts/scan-secrets.mjs
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();

const IGNORE_DIRS = new Set([
    '.git',
    'node_modules',
    'caches',
    'package/storage',
]);

const FILE_LIMIT_BYTES = 400 * 1024;

const PATTERNS = [
    { name: 'OpenRouter key', re: /sk-or-v1-[A-Za-z0-9]{20,}/g },
    { name: 'Generic API key-ish', re: /(api[_-]?key\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"])/ig },
];

function shouldIgnore(rel) {
    const parts = rel.split(path.sep);
    return parts.some(p => IGNORE_DIRS.has(p));
}

function walk(dir, out) {
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const rel = path.relative(ROOT, full);
        if (shouldIgnore(rel)) continue;
        const st = fs.statSync(full);
        if (st.isDirectory()) walk(full, out);
        else out.push({ full, rel, size: st.size });
    }
}

function isTextFile(rel) {
    return /\.(mjs|cjs|js|ts|tsx|json|md|txt|yml|yaml)$/i.test(rel);
}

function scanFile(file) {
    if (!isTextFile(file.rel)) return [];
    if (file.size > FILE_LIMIT_BYTES) return [];
    let text;
    try { text = fs.readFileSync(file.full, 'utf-8'); } catch { return []; }
    const hits = [];
    for (const p of PATTERNS) {
        let m;
        while ((m = p.re.exec(text)) !== null) {
            hits.push({ pattern: p.name, index: m.index, match: m[0] });
            if (hits.length > 20) break;
        }
    }
    return hits;
}

const files = [];
walk(ROOT, files);

let found = 0;
for (const f of files) {
    const hits = scanFile(f);
    if (hits.length === 0) continue;
    found += hits.length;
    console.error(`\n[secret-scan] ${f.rel}`);
    for (const h of hits.slice(0, 5)) {
        // Never print full secret.
        const snippet = String(h.match).slice(0, 12) + '...';
        console.error(`  - ${h.pattern}: ${snippet}`);
    }
}

if (found > 0) {
    console.error(`\n[secret-scan] FAILED: ${found} potential secret(s) found.`);
    process.exit(2);
} else {
    console.log('[secret-scan] OK: no obvious secrets found.');
}
