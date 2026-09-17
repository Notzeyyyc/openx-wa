import crypto from 'crypto';
import path from 'path';
import { loadJsonConfig, writeJsonConfig } from './config.js';
import { DATA_DIR } from './paths.js';

const OWNER_FILE = path.join(DATA_DIR, 'owner.json');

export function getOwner() {
    const owner = loadJsonConfig(OWNER_FILE, null);
    return owner?.jid ? owner : null;
}

export function isOwner(jid) {
    if (!jid) return false;
    const owner = getOwner();
    return !!owner && String(jid).split(':')[0] === owner.jid;
}

/**
 * Generate (and persist) a one-time setup code when no owner exists yet.
 * Returns the code so the boot log can display it; null if already claimed.
 */
export function ensureSetupCode() {
    const existing = loadJsonConfig(OWNER_FILE, {});
    if (existing.jid) return null;
    if (existing.code) return existing.code;

    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    writeJsonConfig(OWNER_FILE, { ...existing, code, codeCreatedAt: Date.now() });
    return code;
}

export function getSetupCode() {
    return loadJsonConfig(OWNER_FILE, {}).code || null;
}

/**
 * Claim ownership with the setup code. One-time: once claimed, locked.
 */
export function claimOwner(jid, name, code) {
    const current = loadJsonConfig(OWNER_FILE, {});
    if (current.jid) return { ok: false, reason: 'claimed' };
    if (!current.code) return { ok: false, reason: 'no_code' };
    if (String(code || '').trim().toUpperCase() !== current.code) return { ok: false, reason: 'bad_code' };

    const jidClean = String(jid).split(':')[0];
    writeJsonConfig(OWNER_FILE, { jid: jidClean, name: name || '', claimedAt: Date.now() });
    return { ok: true, owner: { jid: jidClean, name: name || '' } };
}

export function clearOwner() {
    writeJsonConfig(OWNER_FILE, {});
}
