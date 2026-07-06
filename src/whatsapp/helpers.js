import fs from 'fs';
import path from 'path';

/**
 * Fetch URL and return as Buffer
 */
export async function fetchBuffer(url) {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
    } catch {
        return null;
    }
}

export function stripMarkdown(text) {
    if (!text) return text;
    return text
        .replace(/\*\*/g, '')
        .replace(/__/g, '')
        .replace(/_/g, '')
        .replace(/`/g, '')
        .replace(/\[\]/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/#{1,6}\s/g, '')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();
}

export function generateFileId() {
    return Math.floor(10000 + Math.random() * 90000).toString();
}

export function ensureUserDir(chatId) {
    const cleanId = String(chatId).split('@')[0];
    const dir = path.join("./caches/files", cleanId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

export function saveLocalFile(chatId, buffer, filename) {
    const dir = ensureUserDir(chatId);
    const savePath = path.join(dir, filename);
    fs.writeFileSync(savePath, buffer);

    const metaPath = path.join(dir, "meta.json");
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")); } catch {}

    let fileIdNum = generateFileId();
    while (meta[fileIdNum]) fileIdNum = generateFileId();

    meta[fileIdNum] = { localPath: savePath, filename, date: new Date().toISOString() };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    return fileIdNum;
}

export function getLocalFileById(chatId, fileIdNum) {
    const dir = path.join("./caches/files", String(chatId).split('@')[0]);
    const metaPath = path.join(dir, "meta.json");
    try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        return meta[fileIdNum] || null;
    } catch {
        return null;
    }
}

export function getLocalMeta(chatId) {
    const dir = path.join("./caches/files", String(chatId).split('@')[0]);
    const metaPath = path.join(dir, "meta.json");
    try {
        return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    } catch {
        return {};
    }
}

export function setLocalMeta(chatId, meta) {
    const dir = path.join("./caches/files", String(chatId).split('@')[0]);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const metaPath = path.join(dir, "meta.json");
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

export function listLocalFiles(chatId, limit = 15) {
    const meta = getLocalMeta(chatId);
    return Object.entries(meta)
        .map(([id, info]) => ({ id, ...info }))
        .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
        .slice(0, limit);
}

export function deleteLocalFileById(chatId, fileIdNum) {
    const meta = getLocalMeta(chatId);
    const item = meta[fileIdNum];
    if (!item) return { ok: false, reason: "not_found" };
    try {
        if (item.localPath && fs.existsSync(item.localPath)) {
            fs.unlinkSync(item.localPath);
        }
    } catch {}
    delete meta[fileIdNum];
    setLocalMeta(chatId, meta);
    return { ok: true, filename: item.filename || "unknown" };
}

export function renameLocalFileById(chatId, fileIdNum, newName) {
    const safeName = String(newName || '').trim().replace(/[\\/:*?"<>|]/g, '_');
    if (!safeName) return { ok: false, reason: "invalid_name" };
    const meta = getLocalMeta(chatId);
    const item = meta[fileIdNum];
    if (!item) return { ok: false, reason: "not_found" };
    if (!item.localPath || !fs.existsSync(item.localPath)) return { ok: false, reason: "missing_file" };
    const dir = path.dirname(item.localPath);
    const targetPath = path.join(dir, safeName);
    try {
        fs.renameSync(item.localPath, targetPath);
        meta[fileIdNum] = { ...item, localPath: targetPath, filename: safeName, date: new Date().toISOString() };
        setLocalMeta(chatId, meta);
        return { ok: true, filename: safeName };
    } catch {
        return { ok: false, reason: "rename_failed" };
    }
}
