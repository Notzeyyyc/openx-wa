import { log as logFn, error as logError } from '../logger.js';
import { sendThinkingIndicator, deleteThinkingIndicator, sendFormattedResponse } from './response-formatter.js';

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
        let placeholder = null;

        try {
            await waSock.readMessages([msg.key]);
            await waSock.presenceSubscribe(from);
            await waSock.sendPresenceUpdate('composing', from);

            // Show thinking indicator (Meta AI style)
            placeholder = await sendThinkingIndicator(waSock, from, 'Analyzing your message...');

            const aiResponse = await askAI(textMessage, from, isComplex);

            // Delete thinking indicator
            await deleteThinkingIndicator(waSock, from, placeholder);

            // Send formatted response
            const cleanResponse = aiResponse || 'Sorry, something went wrong while processing your message.';
            await sendFormattedResponse(waSock, from, cleanResponse, msg);

            logFn(`Successfully replied to WA message from ${from}`);
        } catch (err) {
            logError(err);
            await deleteThinkingIndicator(waSock, from, placeholder);
            await waSock.sendMessage(from, { text: 'System error, please try again.' }, { quoted: msg });
        }

        // Anti-rate-limit delay
        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    isProcessingQueue = false;
}
