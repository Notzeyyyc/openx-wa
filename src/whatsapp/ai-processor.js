import fs from 'fs';
import path from 'path';
import { chatCompletion } from '../ai-provider.js';
import { loadJsonConfig } from '../config.js';
import { getMainProvider, getMainModel } from '../ai-config.js';
import { error as logError } from '../logger.js';
import { loadHistory, saveMessage, getRecentMessages } from './conversation-store.js';
import { getGroupContext } from './group-training.js';
import { downloadMedia } from '../downloader.js';
import { queueSensitiveAction, sendSensitiveConfirmationPrompt } from './sensitive-actions.js';
import { waSock } from './connection.js';
import { trackAIResponse } from '../analytics.js';

let targetModel = "stepfun/step-3.5-flash:free";

function getCurrentModel() {
    const modelData = loadJsonConfig("./package/model.json", { defaultModel: targetModel });
    return modelData.defaultModel;
}

const STORAGE_CONTEXT_TTL_MS = 15000;
const STORAGE_MAX_FILES = 20;
const STORAGE_MAX_CHARS_PER_FILE = 300;
const storageContextCache = { ts: 0, text: "" };

function buildStorageContext() {
    const now = Date.now();
    if (now - storageContextCache.ts < STORAGE_CONTEXT_TTL_MS) {
        return storageContextCache.text;
    }

    let storageContext = "";
    try {
        const storageDir = "./package/storage";
        if (fs.existsSync(storageDir)) {
            const files = fs.readdirSync(storageDir)
                .map(name => {
                    const full = path.join(storageDir, name);
                    let mtime = 0;
                    try { mtime = fs.statSync(full).mtimeMs; } catch {}
                    return { name, full, mtime };
                })
                .filter(f => fs.existsSync(f.full) && fs.statSync(f.full).isFile())
                .sort((a, b) => b.mtime - a.mtime)
                .slice(0, STORAGE_MAX_FILES);

            for (const f of files) {
                let raw = "";
                try { raw = fs.readFileSync(f.full, "utf-8"); } catch {}
                if (!raw) continue;
                const sliced = raw.length > STORAGE_MAX_CHARS_PER_FILE
                    ? `${raw.slice(0, STORAGE_MAX_CHARS_PER_FILE)}\n...(truncated)`
                    : raw;
                storageContext += `\n[Info/Memory from ${f.name}]:\n${sliced}\n`;
            }
        }
    } catch {}

    storageContextCache.ts = now;
    storageContextCache.text = storageContext;
    return storageContext;
}

/**
 * Main AI processing function.
 * Handles context building and schedule management.
 */
export async function askAI(userMessage, from = null, isComplex = false) {
    let contextData = {};
    try {
        contextData = loadJsonConfig("./package/context.json");
    } catch {}
    
    // Fetch school schedules and tasks info
    let schedulesContext = "";
    try {
        const schedules = loadJsonConfig("./package/schedules.json", []);
        if (schedules.length > 0) {
            schedulesContext = "\n\nSchedules/Tasks Info:\n" + schedules.map(s => `- ${s.day} ${s.time}: ${s.text}`).join("\n");
        }
    } catch(e) {}
    
    // Load persisted memory/info from storage (cached + size-limited)
    const storageContext = buildStorageContext();
    
    // Get server status (uptime, ram, logs)
    let serverStatus = `\n\n[Server Status]: Uptime ${Math.floor(process.uptime() / 60)} mins, RAM ${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB.`;
    try {
        const logContent = fs.readFileSync("./log.txt", "utf-8");
        const logLines = logContent.split('\n').filter(l => l.trim().length > 0).slice(-3).join('\n');
        serverStatus += `\n[Recent Logs (log.txt)]:\n${logLines}`;
    } catch(e) {}
    
    // Aturan Core AI (Hidden from user) - Compact Version
    const aiRules = `\n\nAturan (JANGAN sebut ke user!):
Tag perintah (taruh di akhir reply, tersembunyi):
[ADD_SCHEDULE|Hari|HH:MM|Desc|Target] | [WA_SEND|jid|pesan]
[DOWNLOAD_MEDIA|url] | [PRE_NOTIFY|pesan]
Sebelum aksi sensitif, kasih [PRE_NOTIFY|pesan] dulu. Use 'none' jika Target WA tidak diketahui.`;

    // Load personality settings
    let personalities = { active: "default", profiles: {} };
    try {
        personalities = loadJsonConfig("./package/personalities.json");
    } catch (e) {}
    
    const activeProfile = personalities.profiles[personalities.active] || personalities.profiles["default"];
    const personalityPrompt = activeProfile ? activeProfile.prompt : "Lu adalah OPENX, asisten AI khusus buat pelajar.";

    // Get group context if in a group
    const isGroup = from?.endsWith('@g.us');
    const groupContext = isGroup ? getGroupContext(from) : '';
    const groupContextPrompt = groupContext ? `\n\nGroup Context:\n${groupContext}` : '';

    const systemPrompt = personalityPrompt + schedulesContext + storageContext + serverStatus + groupContextPrompt + aiRules;

    // Load conversation history for context
    const history = from ? getRecentMessages(from, 10) : [];

    let messages = [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: userMessage }
    ];

    // Save user message to history
    if (from) saveMessage(from, 'user', userMessage);

    const startTime = Date.now();
    const provider = getMainProvider();
    const model = getMainModel() || getCurrentModel();
    let aiResult = await chatCompletion(messages, model, isComplex, from, provider) || "";
    const responseTimeMs = Date.now() - startTime;
    if (from) trackAIResponse(from, responseTimeMs, model);
    
    // Optional pre-notify message to user before actions
    const preNotifyRegex = /\[PRE_NOTIFY\|(.*?)\]/g;
    let pnMatch;
    while ((pnMatch = preNotifyRegex.exec(aiResult)) !== null) {
        if (from && waSock) {
            await waSock.sendMessage(from, { text: pnMatch[1].trim() }).catch(() => {});
        }
    }
    aiResult = aiResult.replace(preNotifyRegex, '');
    
    // Schedule Setup Parser
    const regex = /\[ADD_SCHEDULE\|(.*?)\|(.*?)\|(.*?)\|(.*?)\]/g;
    let match;
    while ((match = regex.exec(aiResult)) !== null) {
        try {
            let dayStr = match[1].trim().toLowerCase();
            const timeStr = match[2].trim();
            const desc = match[3].trim();
            const targetWa = match[4].trim() === "none" ? null : match[4].trim();
            
            // Relative day handling
            if (dayStr === 'besok') { const d = ['minggu','senin','selasa','rabu','kamis','jumat','sabtu']; dayStr = d[(new Date().getDay() + 1) % 7]; }
            if (dayStr === 'hari ini' || dayStr === 'nanti') { const d = ['minggu','senin','selasa','rabu','kamis','jumat','sabtu']; dayStr = d[new Date().getDay()]; }
            
            const dayMap = { "minggu": 0, "senin": 1, "selasa": 2, "rabu": 3, "kamis": 4, "jumat": 5, "sabtu": 6 };
            const dayIdx = dayMap[dayStr] !== undefined ? dayMap[dayStr] : '*';
            
            let [hh, mm] = timeStr.split(':');
            if (hh && mm) {
                let cronString = `${parseInt(mm)} ${parseInt(hh)} * * ${dayIdx}`;
                const schedulePath = "./package/schedules.json";
                let schedules = [];
                if (fs.existsSync(schedulePath)) schedules = JSON.parse(fs.readFileSync(schedulePath, "utf-8"));
                
                schedules.push({
                    id: Date.now().toString().slice(-6),
                    day: dayStr,
                    time: timeStr,
                    cronString: cronString,
                    text: desc,
                    targets: targetWa ? [targetWa] : []
                });
                fs.writeFileSync(schedulePath, JSON.stringify(schedules, null, 2));
            }
        } catch(e) {}
    }
    aiResult = aiResult.replace(regex, '');

    // WA Send/Chat to someone else
    const waSendRegex = /\[WA_SEND\|(.*?)\|(.*?)\]/g;
    let waMatch;
    const waPending = [];
    while ((waMatch = waSendRegex.exec(aiResult)) !== null) {
        waPending.push({ target: waMatch[1].trim(), text: waMatch[2].trim() });
    }
    if (waPending.length > 0 && from && waSock) {
        const token = queueSensitiveAction(from, 'wa_send', { messages: waPending }, `WA send x${waPending.length}`);
        await sendSensitiveConfirmationPrompt(waSock, from, `Aksi sensitif: kirim pesan ke nomor lain (${waPending.length} target)`, token);
    }
    aiResult = aiResult.replace(waSendRegex, '');

    // DOWNLOAD_MEDIA Tag Handler
    const dlRegex = /\[DOWNLOAD_MEDIA\|(.*?)\]/g;
    let dlMatch;
    while ((dlMatch = dlRegex.exec(aiResult)) !== null) {
        const url = dlMatch[1].trim();
        downloadMedia(url).then(async (res) => {
            if (from && waSock) {
                if (res.type === "video") await waSock.sendMessage(from, { video: res.buffer, fileName: res.filename });
                else if (res.type === "audio") await waSock.sendMessage(from, { audio: res.buffer, fileName: res.filename });
                else await waSock.sendMessage(from, { document: res.buffer, fileName: res.filename, mimetype: "application/octet-stream" });
            }
        }).catch(err => logError(`Download failed for ${url}:`, err));
    }
    aiResult = aiResult.replace(dlRegex, '');

    // Save AI response to history
    if (from && aiResult) saveMessage(from, 'assistant', aiResult);

    return aiResult.trim();
}
