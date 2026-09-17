import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OWNER_FILE = path.join(ROOT, 'data', 'owner.json');
const ownerBackup = fs.existsSync(OWNER_FILE) ? fs.readFileSync(OWNER_FILE, 'utf-8') : null;

const { clearOwner, ensureSetupCode, claimOwner } = await import('../owner.js');

// Start from a known state: owner already claimed by 628123.
clearOwner();
const setupCode = ensureSetupCode();
claimOwner('628123@s.whatsapp.net', 'tester', setupCode);

const { handleCommands } = await import('./commands.js');

test.after(() => {
    if (ownerBackup === null) { try { fs.unlinkSync(OWNER_FILE); } catch {} }
    else fs.writeFileSync(OWNER_FILE, ownerBackup);
});

function fakeSock() {
    const sent = [];
    return {
        sent,
        sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'x', remoteJid: jid } }; },
    };
}

const run = async (text, from = '628123@s.whatsapp.net') => {
    const waSock = fakeSock();
    const handled = await handleCommands(from, text, { key: {} }, waSock);
    return { handled, waSock };
};

test('dispatch: order + routing', async () => {
    assert.equal((await run('random chat')).handled, false);
    assert.equal((await run('files')).handled, true);
    assert.equal((await run('reset')).handled, true);
    assert.equal((await run('baru')).handled, true); // was unreachable regex bug
    assert.equal((await run('.group approve')).handled, true); // special-case before generic .group
    assert.equal((await run('.group nimbrung on')).handled, true);
    assert.equal((await run('.group settings')).handled, true);
    assert.equal((await run('.ai status')).handled, true);
    assert.equal((await run('ram')).handled, true);
    assert.equal((await run('ram trend')).handled, true); // must not hit generic ram regex
    assert.equal((await run('cancel confirm')).handled, true);
    assert.equal((await run('confirm:ABCD')).handled, true); // colon form
    assert.equal((await run('confirm ABCD')).handled, true); // space form
});

test('dispatch: group-only guard keeps approve priority', async () => {
    const waSock = fakeSock();
    const handled = await handleCommands('628123@s.whatsapp.net', '.group approve', { key: {} }, waSock);
    assert.equal(handled, true);
    assert.match(waSock.sent[0].content.text, /only work in groups/);
});

test('admin gate: privileged commands blocked for non-owner, allowed for owner', async () => {
    for (const cmd of ['.ai status', '.note list', '.reminder list', 'reset', '.group settings']) {
        const { handled, waSock } = await run(cmd, '628999@s.whatsapp.net');
        assert.equal(handled, true, `${cmd} should be handled (denied)`);
        assert.match(waSock.sent[0].content.text, /Khusus owner/, cmd);
    }
    // owner passes the gate (in DM, group cmds hit the group guard instead)
    const { waSock } = await run('.ai status', '628123@s.whatsapp.net');
    assert.match(waSock.sent[0].content.text, /AI Configuration/);
    // participant in a group counts as sender
    const sock = fakeSock();
    const handled = await handleCommands('62groups@g.us', '.group settings', { key: { participant: '628999@s.whatsapp.net' } }, sock);
    assert.equal(handled, true);
    assert.match(sock.sent[0].content.text, /Khusus owner/);
});

test('owner claim: wrong code rejected, correct code claims, then locked', async () => {
    clearOwner();
    const code = ensureSetupCode();

    const wrong = await run('.start NOPE');
    assert.match(wrong.waSock.sent[0].content.text, /Kode setup salah/);

    const noCode = await run('.start');
    assert.match(noCode.waSock.sent[0].content.text, /Kode setup/);

    const claimed = await run(`.start ${code}`, '628123@s.whatsapp.net');
    assert.match(claimed.waSock.sent[0].content.text, /Owner aktif/);

    // once claimed, someone else cannot take it
    const locked = await run(`.start ${code}`, '628999@s.whatsapp.net');
    assert.match(locked.waSock.sent[0].content.text, /sudah punya owner/);

    // owner sees status via /start
    const status = await run('/start', '628123@s.whatsapp.net');
    assert.match(status.waSock.sent[0].content.text, /owner bot ini/);
});

test('prefix: /ai routes like .ai', async () => {
    const { handled, waSock } = await run('/ai status', '628123@s.whatsapp.net');
    assert.equal(handled, true);
    assert.match(waSock.sent[0].content.text, /AI Configuration/);
});
