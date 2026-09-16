import test from 'node:test';
import assert from 'node:assert';

process.env.OPENX_DEV_PHONE_NUMBER = '628123';
const { handleCommands } = await import('./commands.js');

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
    assert.equal((await run('.group settings')).handled, true);
    assert.equal((await run('.ai status')).handled, true);
    assert.equal((await run('ram')).handled, true);
    assert.equal((await run('ram trend')).handled, true); // must not hit generic ram regex
    assert.equal((await run('cancel confirm')).handled, true);
    assert.equal((await run('confirm:ABCD')).handled, true); // colon form
    assert.equal((await run('confirm ABCD')).handled, true); // space form
    assert.equal((await run('.personality LIST')).handled, true); // case-insensitive sub
});

test('dispatch: group-only guard keeps approve priority', async () => {
    const waSock = fakeSock();
    const handled = await handleCommands('628123@s.whatsapp.net', '.group approve', { key: {} }, waSock);
    assert.equal(handled, true);
    assert.match(waSock.sent[0].content.text, /only work in groups/);
});

test('admin gate: privileged commands blocked for non-admin, allowed for admin', async () => {
    for (const cmd of ['.ai status', '.note list', 'stats', '.reminder list', 'reset', '.group settings']) {
        const { handled, waSock } = await run(cmd, '628999@s.whatsapp.net');
        assert.equal(handled, true, `${cmd} should be handled (denied)`);
        assert.match(waSock.sent[0].content.text, /Khusus admin/, cmd);
    }
    // admin passes the gate (in DM, group cmds hit the group guard instead)
    const { waSock } = await run('.ai status', '628123@s.whatsapp.net');
    assert.match(waSock.sent[0].content.text, /AI Configuration/);
    // participant in a group counts as sender
    const sock = fakeSock();
    const handled = await handleCommands('62groups@g.us', '.group settings', { key: { participant: '628999@s.whatsapp.net' } }, sock);
    assert.equal(handled, true);
    assert.match(sock.sent[0].content.text, /Khusus admin/);
});
