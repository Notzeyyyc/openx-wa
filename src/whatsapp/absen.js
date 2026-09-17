import path from 'path';
import { loadJsonConfig, writeJsonConfig } from '../config.js';
import { DATA_DIR } from '../paths.js';

const ABSEN_FILE = path.join(DATA_DIR, 'absen.json');
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

const sessions = new Map(); // groupJid -> { title, openedBy, hadir: Map, openedAt }

export function openSession(jid, title, openedBy) {
    const session = {
        title: title || 'Absensi',
        openedBy: openedBy || '',
        hadir: new Map(),
        openedAt: Date.now()
    };
    sessions.set(jid, session);
    return session;
}

export function getSession(jid) {
    const s = sessions.get(jid);
    if (!s) return null;
    if (Date.now() - s.openedAt > SESSION_TTL_MS) { sessions.delete(jid); return null; }
    return s;
}

export function markPresent(jid, memberJid, name) {
    const s = getSession(jid);
    if (!s) return { ok: false, reason: 'no_session' };

    const already = s.hadir.has(memberJid);
    if (!already) s.hadir.set(memberJid, name || memberJid.split('@')[0]);
    return { ok: true, already, count: s.hadir.size };
}

export function closeSession(jid) {
    const s = getSession(jid);
    sessions.delete(jid);
    if (!s) return null;

    const record = {
        title: s.title,
        openedBy: s.openedBy,
        hadir: [...s.hadir.entries()].map(([memberJid, name]) => ({ jid: memberJid, name })),
        openedAt: s.openedAt,
        closedAt: Date.now()
    };

    const all = loadJsonConfig(ABSEN_FILE, {});
    (all[jid] ??= []).push(record);
    writeJsonConfig(ABSEN_FILE, all);
    return record;
}

export function formatHadir(session) {
    if (!session) return '';
    const list = [...session.hadir.entries()].map(([, name], i) => `${i + 1}. ${name}`);
    return `📋 *${session.title}*\nHadir (${session.hadir.size}):\n${list.join('\n') || '(belum ada)'}`;
}
