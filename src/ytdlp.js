import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { config } from './config.js';
import { log } from './logger.js';

const BIN_PATH = config.ytdlp.path;

/** Standalone yt-dlp release asset for a platform/arch (no Python needed). */
export function releaseAsset(platform = process.platform, arch = process.arch) {
    if (platform === 'win32') return 'yt-dlp.exe';
    if (platform === 'darwin') return 'yt-dlp_macos';
    if (platform === 'linux') {
        if (arch === 'arm64') return 'yt-dlp_linux_aarch64';
        if (arch === 'x64') return 'yt-dlp_linux';
    }
    return null;
}

/** yt-dlp format selector: single-file (no ffmpeg merge needed). */
export function pickFormat(mode = 'video') {
    return mode === 'audio'
        ? 'bestaudio[ext=m4a]/bestaudio/best'
        : 'b[height<=720][ext=mp4]/b[height<=720]/b';
}

export function isHttpUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

function binaryUrl(asset, channel) {
    const repo = channel === 'stable' ? 'yt-dlp/yt-dlp' : 'yt-dlp/yt-dlp-nightly-builds';
    return `https://github.com/${repo}/releases/latest/download/${asset}`;
}

export function isAvailable() {
    try {
        fs.accessSync(BIN_PATH, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

export async function downloadBinary({ force = false } = {}) {
    if (!force && isAvailable()) return BIN_PATH;

    const asset = releaseAsset();
    if (!asset) throw new Error(`Platform ga didukung buat yt-dlp: ${process.platform}/${process.arch}`);

    const url = binaryUrl(asset, config.ytdlp.channel);
    log(`[yt-dlp] Downloading ${asset} (${config.ytdlp.channel})...`);
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(180000) });
    if (!res.ok) throw new Error(`Download gagal: HTTP ${res.status}`);

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100_000) throw new Error('File yang ke-download bukan binary yt-dlp.');

    fs.mkdirSync(path.dirname(BIN_PATH), { recursive: true });
    fs.writeFileSync(BIN_PATH, buf);
    if (process.platform !== 'win32') fs.chmodSync(BIN_PATH, 0o755);
    log(`[yt-dlp] Installed: ${BIN_PATH}`);
    return BIN_PATH;
}

let downloadPromise = null;

/** Ensure the binary exists, downloading it once at most concurrently. */
export function ensureBinary() {
    if (isAvailable()) return Promise.resolve(BIN_PATH);
    if (!downloadPromise) {
        downloadPromise = downloadBinary().finally(() => { downloadPromise = null; });
    }
    return downloadPromise;
}

/** Resolve a direct media URL via `yt-dlp -g` (no download, no ffmpeg). */
export async function resolveMediaUrl(url, { mode = 'video' } = {}) {
    if (!isHttpUrl(url)) throw new Error('URL ga valid (harus http/https).');
    await ensureBinary();

    return new Promise((resolve, reject) => {
        const args = [
            '--no-playlist', '-I', '1', '--no-warnings',
            '--js-runtimes', config.ytdlp.jsRuntime,
            '-f', pickFormat(mode),
            '-g', '--', url
        ];
        execFile(BIN_PATH, args, { timeout: 60000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            const line = String(stdout || '').split('\n').map(s => s.trim()).find(Boolean);
            if (line) return resolve(line);
            const detail = String(stderr || err?.message || '').split('\n')[0].slice(0, 200);
            reject(new Error(`yt-dlp gagal: ${detail || 'ga ada output'}`));
        });
    });
}

function runYtdlp(args, { timeout = 180000 } = {}) {
    return new Promise((resolve, reject) => {
        execFile(BIN_PATH, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (!err) return resolve(stdout);
            const line = String(stderr || '').split('\n').map(s => s.trim()).filter(Boolean).pop();
            reject(new Error(`yt-dlp gagal: ${(line || err.message).slice(0, 200)}`));
        });
    });
}

/**
 * Download (+ merge with ffmpeg when needed) to a temp file and return the buffer.
 * Used as a fallback when no single progressive format exists (common on YouTube).
 */
export async function downloadToTemp(url, { mode = 'video' } = {}) {
    if (!isHttpUrl(url)) throw new Error('URL ga valid (harus http/https).');
    await ensureBinary();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-ytdlp-'));
    try {
        const fmt = mode === 'audio'
            ? 'bestaudio/best'
            : 'bv*[height<=720]+ba/b[height<=720]/b';
        const post = mode === 'audio' ? ['-x', '--audio-format', 'm4a'] : ['--merge-output-format', 'mp4'];
        const args = [
            '--no-playlist', '-I', '1', '--no-warnings',
            '--js-runtimes', config.ytdlp.jsRuntime,
            '--max-filesize', `${config.ytdlp.maxMb}M`,
            '-f', fmt, ...post,
            '-o', path.join(dir, 'media.%(ext)s'),
            '--', url
        ];
        await runYtdlp(args);

        const file = fs.readdirSync(dir)
            .filter(f => !f.endsWith('.part'))
            .map(f => ({ f, size: fs.statSync(path.join(dir, f)).size }))
            .sort((a, b) => b.size - a.size)[0];
        if (!file) throw new Error('yt-dlp ga ngehasilin file.');

        return { buffer: fs.readFileSync(path.join(dir, file.f)), ext: path.extname(file.f).replace('.', '') || 'bin' };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
