import fs from 'fs';
import path from 'path';

const CONV_DIR = "./package/conversations";
const MAX_MESSAGES = 20; // keep last N messages per user
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min cache

// In-memory cache: chatId → { messages, lastAccess }
const cache = new Map();

function ensureDir() {
    if (!fs.existsSync(CONV_DIR)) fs.mkdirSync(CONV_DIR, { recursive: true });
}

function getFilePath(chatId) {
    const cleanId = String(chatId).split('@')[0];
    return path.join(CONV_DIR, `${cleanId}.json`);
}

export function loadHistory(chatId) {
    const now = Date.now();
    const cached = cache.get(chatId);
    if (cached && now - cached.lastAccess < CACHE_TTL_MS) {
        return cached.messages;
    }

    const filePath = getFilePath(chatId);
    let messages = [];
    try {
        if (fs.existsSync(filePath)) {
            messages = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
    } catch {}

    cache.set(chatId, { messages, lastAccess: now });
    return messages;
}

export function saveMessage(chatId, role, content) {
    ensureDir();
    const messages = loadHistory(chatId);

    messages.push({ role, content, ts: Date.now() });

    // Trim to max
    while (messages.length > MAX_MESSAGES) messages.shift();

    cache.set(chatId, { messages, lastAccess: Date.now() });

    const filePath = getFilePath(chatId);
    fs.writeFileSync(filePath, JSON.stringify(messages, null, 2));
}

export function clearHistory(chatId) {
    cache.delete(chatId);
    const filePath = getFilePath(chatId);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export function getRecentMessages(chatId, count = 10) {
    const history = loadHistory(chatId);
    return history.slice(-count);
}

export function cleanupOldSessions() {
    const now = Date.now();
    for (const [chatId, entry] of cache) {
        if (now - entry.lastAccess > CACHE_TTL_MS * 2) {
            cache.delete(chatId);
        }
    }
}

// Cleanup every 10 min
setInterval(cleanupOldSessions, 10 * 60 * 1000);
