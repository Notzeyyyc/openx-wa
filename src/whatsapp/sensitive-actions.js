export const pendingSensitiveActions = new Map();
const SENSITIVE_TTL_MS = 2 * 60 * 1000;

function createSensitiveToken() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function queueSensitiveAction(chatId, actionType, payload, summary) {
    const token = createSensitiveToken();
    pendingSensitiveActions.set(String(chatId), {
        token, actionType, payload, summary, createdAt: Date.now()
    });
    return token;
}

export async function sendSensitiveConfirmationPrompt(waSock, jid, title, token) {
    const fallbackText =
        `⚠️ ${title}\n` +
        `Ketik *confirm ${token}* untuk lanjut, atau *cancel confirm* untuk batalkan.`;
    if (!waSock) return;
    try {
        await waSock.sendMessage(jid, {
            text: `⚠️ ${title}\nPilih aksi di bawah (atau pakai teks fallback).`,
            footer: `Fallback: confirm ${token}`,
            buttons: [
                { buttonId: `confirm:${token}`, buttonText: { displayText: '✅ Confirm' }, type: 1 },
                { buttonId: 'cancel_confirm', buttonText: { displayText: '❌ Cancel' }, type: 1 }
            ],
            headerType: 1
        });
    } catch {
        await waSock.sendMessage(jid, { text: fallbackText }).catch(() => {});
        return;
    }
    await waSock.sendMessage(jid, { text: fallbackText }).catch(() => {});
}

export async function executeSensitiveAction(pending, from, waSock) {
    if (!pending) return { ok: false, text: "Aksi tidak ditemukan." };
    try {
        if (pending.actionType === 'server_restart') {
            if (from && waSock) {
                await waSock.sendMessage(from, { text: "♻️ Restart server dalam 2 detik..." }).catch(() => {});
            }
            setTimeout(() => process.exit(1), 2000);
            return { ok: true, text: "Restart dijadwalkan." };
        }
        if (pending.actionType === 'wa_send') {
            const list = pending.payload?.messages || [];
            let sent = 0;
            for (const item of list) {
                if (!waSock) break;
                let target = String(item.target || '').trim();
                if (!target) continue;
                if (!target.includes('@')) target = `${target}@s.whatsapp.net`;
                await waSock.sendMessage(target, { text: String(item.text || '') }).catch(() => {});
                sent++;
            }
            return { ok: true, text: `WA send selesai. Total terkirim: ${sent}` };
        }
        return { ok: false, text: "Tipe aksi tidak dikenali." };
    } catch (e) {
        return { ok: false, text: `Eksekusi gagal: ${e.message}` };
    }
}