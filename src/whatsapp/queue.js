import { runUiFlow } from '../adb-helper.js';
import { log as logFn, error as logError } from '../logger.js';

export const aiQueue = [];
let isProcessingQueue = false;

export const adbBgQueue = [];
let isProcessingAdbBgQueue = false;
export let activeBgTask = null;
let bgTaskSeq = 1;
const bgTaskHistory = [];

export function enqueueBgFlow(flow, from) {
    const task = {
        id: `BG${String(bgTaskSeq++).padStart(4, '0')}`,
        flow, from, status: 'queued',
        createdAt: Date.now(), startedAt: null, finishedAt: null,
        cancelRequested: false, logs: []
    };
    adbBgQueue.push(task);
    return task;
}

export function cancelBgTask(selector = 'last') {
    const key = String(selector || 'last').toLowerCase();
    if (key === 'all') {
        for (const t of adbBgQueue) t.cancelRequested = true;
        adbBgQueue.length = 0;
        if (activeBgTask) activeBgTask.cancelRequested = true;
        return { ok: true, msg: 'Semua queued task dibatalkan. Task aktif akan berhenti setelah step berjalan.' };
    }
    if (key === 'active' || key === 'running') {
        if (!activeBgTask) return { ok: false, msg: 'Tidak ada task aktif.' };
        activeBgTask.cancelRequested = true;
        return { ok: true, msg: `Task aktif ${activeBgTask.id} diminta berhenti.` };
    }
    if (key === 'last') {
        const last = adbBgQueue[adbBgQueue.length - 1];
        if (!last) return { ok: false, msg: 'Tidak ada task queued.' };
        last.cancelRequested = true;
        adbBgQueue.pop();
        return { ok: true, msg: `Task ${last.id} dibatalkan dari queue.` };
    }
    const idx = adbBgQueue.findIndex(t => t.id.toLowerCase() === key);
    if (idx !== -1) {
        adbBgQueue[idx].cancelRequested = true;
        const id = adbBgQueue[idx].id;
        adbBgQueue.splice(idx, 1);
        return { ok: true, msg: `Task ${id} dibatalkan dari queue.` };
    }
    if (activeBgTask && activeBgTask.id.toLowerCase() === key) {
        activeBgTask.cancelRequested = true;
        return { ok: true, msg: `Task aktif ${activeBgTask.id} diminta berhenti.` };
    }
    return { ok: false, msg: `Task ${selector} tidak ditemukan.` };
}

export function getBgStatusText() {
    const queued = adbBgQueue.length;
    const active = activeBgTask
        ? `Aktif: ${activeBgTask.id} (${Math.round((Date.now() - activeBgTask.startedAt) / 1000)}s)`
        : 'Aktif: -';
    const next = adbBgQueue.slice(0, 5).map(t => `${t.id}`).join(', ') || '-';
    return `📦 *Background Queue Status*\n${active}\nQueued: ${queued}\nNext: ${next}`;
}

export async function processAdbBgQueue(waSock) {
    if (isProcessingAdbBgQueue || adbBgQueue.length === 0) return;
    isProcessingAdbBgQueue = true;
    while (adbBgQueue.length > 0) {
        const task = adbBgQueue.shift();
        const { flow, from } = task;
        try {
            if (task.cancelRequested) {
                task.status = 'cancelled';
                task.finishedAt = Date.now();
                bgTaskHistory.push(task);
                continue;
            }
            activeBgTask = task;
            task.status = 'running';
            task.startedAt = Date.now();
            if (from && waSock) {
                await waSock.sendMessage(from, { text: `🛠️ Mulai UI flow background (${task.id})...` }).catch(() => {});
            }
            const result = await runUiFlow(flow, { retries: 2, verifyWaitMs: 700 });
            task.logs = result.logs || [];
            task.finishedAt = Date.now();
            task.status = result.ok ? 'done' : 'failed';
            if (from && waSock) {
                const tail = result.logs.slice(-6).join('\n');
                const msg = result.ok
                    ? `✅ UI flow background ${task.id} selesai.\n${tail}`
                    : `❌ UI flow background ${task.id} gagal.\n${tail}`;
                await waSock.sendMessage(from, { text: msg }).catch(() => {});
            }
        } catch (e) {
            task.finishedAt = Date.now();
            task.status = 'failed';
            task.logs = [...(task.logs || []), `ERROR ${e.message}`];
            if (from && waSock) {
                await waSock.sendMessage(from, { text: `❌ UI flow error: ${e.message}` }).catch(() => {});
            }
        } finally {
            activeBgTask = null;
            bgTaskHistory.push(task);
            if (bgTaskHistory.length > 50) bgTaskHistory.shift();
        }
    }
    isProcessingAdbBgQueue = false;
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