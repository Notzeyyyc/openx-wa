import fs from 'fs';
import path from 'path';
import { chatCompletion } from '../ai-provider.js';
import { loadJsonConfig } from '../config.js';
import { getMainProvider, getMainModel } from '../ai-config.js';
import { handleMcpTags } from './mcp-client.js';
import { error as logError } from '../logger.js';
import { loadHistory, saveMessage, getRecentMessages } from './conversation-store.js';
import {
    getDeviceInfo, getAppList, takeScreenshot, sendNotification,
    getHealthStatus, launchApp, tapByText, tapByResourceId,
    scrollScreen, pressBack, pressHome, dumpUiHierarchy, runUiFlow
} from '../adb-helper.js';
import { downloadMedia } from '../downloader.js';
import { queueSensitiveAction, sendSensitiveConfirmationPrompt } from './sensitive-actions.js';
import { enqueueBgFlow, processAdbBgQueue } from './queue.js';
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
 * Handles context building, ADB command parsing, and schedule management.
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
[ADD_SCHEDULE|Hari|HH:MM|Desc|Target] | [ADB_CMD|perintah] | [ADB_OPEN_APP|pkg]
[ADB_UI_TAP_TEXT|teks] | [ADB_UI_TAP_ID|id] | [ADB_UI_SCROLL|up/down] | [ADB_UI_BACK] | [ADB_UI_HOME]
[ADB_SCREENSHOT] | [ADB_NOTIFY|Judul|Pesan] | [ADB_HEALTH] | [WA_SEND|jid|pesan]
[SERVER_GET_LOG] | [SERVER_RESTART] | [DOWNLOAD_MEDIA|url]
[MCP_SEARCH|query] | [MCP_FILE_READ|path] | [MCP_FILE_WRITE|path|isi]
[MCP_CRON|id|schedule|cmd] | [MCP_NOTIFY|title|content] | [MCP_DEVICE] | [MCP_BATTERY] | [MCP_NETWORK]
Flow: [ADB_UI_FLOW|open:pkg;tap_text:Chats;verify_text:Chats] | [ADB_BG_FLOW|flow]
Sebelum aksi sensitif, kasih [PRE_NOTIFY|pesan] dulu. Use 'none' jika Target WA tidak diketahui.

PENTING: [NEEDS_ADB_INFO] HANYA pakai kalau user nanya spesifik soal device, apps terinstall, RAM, storage, atau kondisi HP. JANGAN pakai buat sapaan biasa (hai/halo/halo juga).`;

    // Load personality settings
    let personalities = { active: "default", profiles: {} };
    try {
        personalities = loadJsonConfig("./package/personalities.json");
    } catch (e) {}
    
    const activeProfile = personalities.profiles[personalities.active] || personalities.profiles["default"];
    const personalityPrompt = activeProfile ? activeProfile.prompt : "Lu adalah OPENX, asisten AI khusus buat pelajar.";

    const systemPrompt = personalityPrompt + schedulesContext + storageContext + serverStatus + aiRules;

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
    
    // Handle dynamic ADB info request
    if (aiResult.includes("[NEEDS_ADB_INFO]")) {
        try {
            const di = await getDeviceInfo();
            const al = await getAppList();
            messages.push({ role: "assistant", content: aiResult });
            messages.push({ role: "user", content: `(System) Real device and app info:\n${di}\n${al}\nNow, fulfill the user request using this real data.` });
            aiResult = await chatCompletion(messages, getCurrentModel(), isComplex, from);
            if (!aiResult) aiResult = "";
        } catch(e) {}
        aiResult = aiResult.replace(/\[NEEDS_ADB_INFO\]/g, "");
    }

    // ADB command gate (sensitive action)
    const adbCmdRegex = /\[ADB_CMD\|(.*?)\]/g;
    let adbMatch;
    const commands = [];
    while ((adbMatch = adbCmdRegex.exec(aiResult)) !== null) {
        commands.push(adbMatch[1].trim());
    }
    if (commands.length > 0 && from) {
        const token = queueSensitiveAction(from, 'adb_cmd', { commands }, `ADB command x${commands.length}`);
        await sendSensitiveConfirmationPrompt(from, `Aksi sensitif terdeteksi: ADB command (${commands.length})`, token);
    }
    aiResult = aiResult.replace(adbCmdRegex, '');

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
    
    // ADB Screenshot Request
    const adbScRegex = /\[ADB_SCREENSHOT\]/g;
    if (adbScRegex.test(aiResult)) {
        if (from && waSock) {
            const tempPath = path.join(process.cwd(), "caches", `ss_${Date.now()}.png`);
            takeScreenshot(tempPath).then(success => {
                if (success) {
                    waSock.sendMessage(from, { image: fs.readFileSync(tempPath) }).catch(()=>{});
                    setTimeout(() => { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); }, 5000);
                }
            });
        }
        aiResult = aiResult.replace(adbScRegex, '');
    }
    
    // Server Logs Request
    const getLogRegex = /\[SERVER_GET_LOG\]/g;
    if (getLogRegex.test(aiResult)) {
        if (from && waSock) {
            try {
                const logPath = "./log.txt";
                if (fs.existsSync(logPath)) {
                    await waSock.sendMessage(from, { document: fs.readFileSync(logPath), fileName: "log.txt", mimetype: "text/plain" });
                }
            } catch(e) {}
        }
        aiResult = aiResult.replace(getLogRegex, '');
    }

    // Server Restart Request
    const restartRegex = /\[SERVER_RESTART\]/g;
    if (restartRegex.test(aiResult)) {
        if (from && waSock) {
            const token = queueSensitiveAction(from, 'server_restart', {}, 'Server restart');
            await sendSensitiveConfirmationPrompt(from, 'Aksi sensitif: restart server', token);
        }
        aiResult = aiResult.replace(restartRegex, '');
    }
    
    // ADB Notification Handler
    const adbNotifyRegex = /\[ADB_NOTIFY\|(.*?)\|(.*?)\]/g;
    let notifyMatch;
    while ((notifyMatch = adbNotifyRegex.exec(aiResult)) !== null) {
        sendNotification(notifyMatch[1], notifyMatch[2]).catch(() => {});
    }
    aiResult = aiResult.replace(adbNotifyRegex, '');

    // UIAutomator / navigation helpers
    const openAppRegex = /\[ADB_OPEN_APP\|(.*?)\]/g;
    let openMatch;
    while ((openMatch = openAppRegex.exec(aiResult)) !== null) {
        await launchApp(openMatch[1].trim());
    }
    aiResult = aiResult.replace(openAppRegex, '');

    const tapTextRegex = /\[ADB_UI_TAP_TEXT\|(.*?)\]/g;
    let tapTextMatch;
    while ((tapTextMatch = tapTextRegex.exec(aiResult)) !== null) {
        await tapByText(tapTextMatch[1].trim());
    }
    aiResult = aiResult.replace(tapTextRegex, '');

    const tapIdRegex = /\[ADB_UI_TAP_ID\|(.*?)\]/g;
    let tapIdMatch;
    while ((tapIdMatch = tapIdRegex.exec(aiResult)) !== null) {
        await tapByResourceId(tapIdMatch[1].trim());
    }
    aiResult = aiResult.replace(tapIdRegex, '');

    const scrollRegex = /\[ADB_UI_SCROLL\|(.*?)\]/g;
    let scrollMatch;
    while ((scrollMatch = scrollRegex.exec(aiResult)) !== null) {
        await scrollScreen(scrollMatch[1].trim());
    }
    aiResult = aiResult.replace(scrollRegex, '');

    if (/\[ADB_UI_BACK\]/.test(aiResult)) {
        await pressBack();
        aiResult = aiResult.replace(/\[ADB_UI_BACK\]/g, '');
    }
    if (/\[ADB_UI_HOME\]/.test(aiResult)) {
        await pressHome();
        aiResult = aiResult.replace(/\[ADB_UI_HOME\]/g, '');
    }
    if (/\[ADB_UI_DUMP\]/.test(aiResult)) {
        const dump = await dumpUiHierarchy();
        if (dump.ok) {
            messages.push({ role: "assistant", content: aiResult });
            messages.push({ role: "user", content: `(System) UI dump success. Node count: ${dump.nodeCount}. Suggest next navigation step in plain language.` });
            aiResult = await chatCompletion(messages, getCurrentModel(), isComplex) || aiResult;
        }
        aiResult = aiResult.replace(/\[ADB_UI_DUMP\]/g, '');
    }

    const uiFlowRegex = /\[ADB_UI_FLOW\|(.*?)\]/g;
    let flowMatch;
    while ((flowMatch = uiFlowRegex.exec(aiResult)) !== null) {
        const flow = flowMatch[1].trim();
        const result = await runUiFlow(flow, { retries: 2, verifyWaitMs: 700 });
        if (from && waSock) {
            const tail = result.logs.slice(-6).join('\n');
            const msg = result.ok
                ? `✅ UI flow selesai.\n${tail}`
                : `❌ UI flow gagal.\n${tail}`;
            await waSock.sendMessage(from, { text: msg }).catch(() => {});
        }
    }
    aiResult = aiResult.replace(uiFlowRegex, '');

    const bgFlowRegex = /\[ADB_BG_FLOW\|(.*?)\]/g;
    let bgFlowMatch;
    while ((bgFlowMatch = bgFlowRegex.exec(aiResult)) !== null) {
        const flow = bgFlowMatch[1].trim();
        const task = enqueueBgFlow(flow, from);
        if (from && waSock) {
            await waSock.sendMessage(from, { text: `📥 BG task masuk queue: ${task.id}` }).catch(() => {});
        }
        processAdbBgQueue();
    }
    aiResult = aiResult.replace(bgFlowRegex, '');

    // ADB Health Handler
    if (aiResult.includes("[ADB_HEALTH]")) {
        try {
            const healthReport = await getHealthStatus();
            messages.push({ role: "assistant", content: aiResult });
            messages.push({ role: "user", content: `(System) Real Health Info:\n${healthReport}\nTell the user about this health status naturally.` });
            aiResult = await chatCompletion(messages, getCurrentModel(), isComplex, from);
            if (!aiResult) aiResult = "";
        } catch(e) {}
        aiResult = aiResult.replace(/\[ADB_HEALTH\]/g, "");
    }

    // WA Send/Chat to someone else
    const waSendRegex = /\[WA_SEND\|(.*?)\|(.*?)\]/g;
    let waMatch;
    const waPending = [];
    while ((waMatch = waSendRegex.exec(aiResult)) !== null) {
        waPending.push({ target: waMatch[1].trim(), text: waMatch[2].trim() });
    }
    if (waPending.length > 0 && from && waSock) {
        const token = queueSensitiveAction(from, 'wa_send', { messages: waPending }, `WA send x${waPending.length}`);
        await sendSensitiveConfirmationPrompt(from, `Aksi sensitif: kirim pesan ke nomor lain (${waPending.length} target)`, token);
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

    // ── MCP Tag Handlers ──────────────────────────────────────────────
    aiResult = await handleMcpTags(aiResult, from, waSock);
    // ── End MCP Tags ──────────────────────────────────────────────────

    // Save AI response to history
    if (from && aiResult) saveMessage(from, 'assistant', aiResult);

    return aiResult.trim();
}
