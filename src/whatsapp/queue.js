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
        let indicator = null;

        try {
            await waSock.readMessages([msg.key]);
            await waSock.presenceSubscribe(from);
            await waSock.sendPresenceUpdate('composing', from);

            // Send thinking indicator with live updates
            indicator = await sendThinkingIndicator(waSock, from);

            // Simulate step updates while AI processes
            const stepsPromise = (async () => {
                for (let i = 0; i < 3; i++) {
                    await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
                    if (indicator?.update) await indicator.update();
                }
            })();

            const aiResponse = await askAI(textMessage, from, isComplex);

            // Wait for steps to finish
            await stepsPromise;

            // Mark as done
            if (indicator?.done) await indicator.done();

            // Small delay before sending actual response
            await new Promise(r => setTimeout(r, 300));

            // Send formatted response
            const cleanResponse = aiResponse || 'Hmm, I could not generate a response.';
            await sendFormattedResponse(waSock, from, cleanResponse, msg);

            logFn(`Successfully replied to WA message from ${from}`);
        } catch (err) {
            logError(err);
            // Delete indicator on error
            if (indicator?.msgId) {
                await deleteThinkingIndicator(waSock, from, indicator);
            }
            await waSock.sendMessage(from, { text: 'System error, please try again.' }, { quoted: msg });
        }

        // Rate limit delay
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    isProcessingQueue = false;
}
