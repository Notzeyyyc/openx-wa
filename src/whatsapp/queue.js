import { log as logFn, error as logError } from '../logger.js';

export const aiQueue = [];
let isProcessingQueue = false;

export let activeBgTask = null;

export function cancelBgTask(selector = 'last') {
    return { ok: false, msg: 'Tidak ada task queued.' };
}

export function getBgStatusText() {
    return `📦 *Background Queue Status*\nAktif: -\nQueued: 0\nNext: -`;
}

export async function processQueue(waSock, askAI, stripMarkdown) {
    if (isProcessingQueue || aiQueue.length === 0) return;
    isProcessingQueue = true;
    while (aiQueue.length > 0) {
        const { msg, textMessage, from, isComplex } = aiQueue.shift();
        try {
            await waSock.readMessages([msg.key]);
            await waSock.presenceSubscribe(from);
            await waSock.sendPresenceUpdate('composing', from);
            const aiResponse = await askAI(textMessage, from, isComplex);
            const cleanResponse = stripMarkdown(aiResponse) || 'Sorry, something went wrong while processing your message.';
            await waSock.sendPresenceUpdate('paused', from);
            await waSock.sendMessage(from, { text: cleanResponse }, { quoted: msg });
            logFn(`Successfully replied to WA message from ${from}`);
        } catch (err) {
            logError(err);
            await waSock.sendMessage(from, { text: 'System error, please try again.' }, { quoted: msg });
        }
        await new Promise(resolve => setTimeout(resolve, 18000));
    }
    isProcessingQueue = false;
}
