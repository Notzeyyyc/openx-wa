import { config } from './config.js';
import { resolveMediaUrl, downloadToTemp } from './ytdlp.js';

/**
 * Download media via the local yt-dlp binary.
 * Fast path resolves a direct URL with `yt-dlp -g` (no temp files / no ffmpeg);
 * if no single-file format exists (common on YouTube), falls back to a
 * download + ffmpeg merge into a temp file.
 * Returns { buffer, filename, type }.
 */
export async function downloadMedia(url, { mode = 'video' } = {}) {
    let buffer;
    let ext;

    try {
        const mediaUrl = await resolveMediaUrl(url, { mode });
        const response = await fetch(mediaUrl, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        buffer = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get('content-type') || '';
        ext = mode === 'audio' ? 'm4a' : (contentType.includes('video') || contentType.includes('mp4') ? 'mp4' : 'bin');
    } catch {
        const tmp = await downloadToTemp(url, { mode });
        buffer = tmp.buffer;
        ext = tmp.ext;
    }

    const maxBytes = config.ytdlp.maxMb * 1024 * 1024;
    if (buffer.length > maxBytes) {
        const size = (buffer.length / 1048576).toFixed(1);
        throw new Error(`File kegedean (${size}MB > ${config.ytdlp.maxMb}MB).`);
    }

    const type = mode === 'audio' ? 'audio' : (ext === 'mp4' ? 'video' : 'document');
    return { buffer, filename: `openx_dl_${Date.now()}.${ext}`, type };
}
