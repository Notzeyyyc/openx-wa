import fs from 'fs';
import { loadJsonConfig, writeJsonConfig } from '../config.js';
import {
    fetchBuffer,
    listLocalFiles, deleteLocalFileById, renameLocalFileById
} from './helpers.js';
import { webSearch } from './web-search.js';
import { generateImage } from './image-gen.js';
import { pendingSensitiveActions, executeSensitiveAction } from './sensitive-actions.js';
import { downloadSong, searchSongs, downloadByTrackUrl } from './music-handler.js';
import { cacheSearchResults, getCachedTrack } from './track-cache.js';
import { clearHistory } from './conversation-store.js';
import { getRamReport, getRamTrend, forceGarbageCollect } from './ram-monitor.js';
import { spawnAgent, getAgentsStatus } from './agent-manager.js';
import {
    getMainModel, setMainModel, setMainApiKey, setMainBaseUrl, setAgentApiKey,
    getAIStatus, getActiveProfileName, setActiveProfile, saveProfile,
    listProfiles, deleteProfile, setAgentProfile, isAgentic, setAgentic
} from '../ai-config.js';
import { getStatsSummary } from '../analytics.js';
import { sendButtons, sendList } from './interactive.js';
import { addNote, listNotes, deleteNote, searchNotes } from './notes.js';
import { setReminder, listReminders, cancelReminder } from './reminders.js';
import { sendVoiceNote, getVoiceList } from './voice-handler.js';
import { getGroup, setGroup, setGroupApproved, setGroupDelay } from './group-manager.js';
import { trainGroup, addGroupRule, removeGroupRule, addGroupTopic, getGroupContext, getGroupTraining } from './group-training.js';

const SENSITIVE_TTL_MS = 2 * 60 * 1000;
const AGENT_TYPES = ['research', 'code', 'translate', 'summary', 'homework', 'essay', 'solver', 'vision'];

// --- tiny helpers shared by all handlers ---
const reply = (ctx, text) => ctx.waSock.sendMessage(ctx.from, { text }, { quoted: ctx.msg });
const replyErr = (ctx, err) => reply(ctx, `❌ ${err}`);
const envSet = (key, value) => {
    let env = '';
    try { env = fs.readFileSync('./.env', 'utf-8'); } catch {}
    env = new RegExp(`^${key}=.*`, 'm').test(env)
        ? env.replace(new RegExp(`^${key}=.*`, 'm'), `${key}=${value}`)
        : env + `\n${key}=${value}\n`;
    fs.writeFileSync('./.env', env);
    process.env[key] = value;
};

async function editNowPlaying(ctx, searchMsg, { title, body, cover, sourceUrl, plainText }) {
    if (cover) {
        const thumbnail = await fetchBuffer(cover);
        await ctx.waSock.sendMessage(ctx.from, {
            text: title,
            edit: searchMsg.key,
            externalAdReply: {
                title: plainText.title, body: plainText.body,
                thumbnail: thumbnail || undefined,
                largeThumbnail: true,
                sourceUrl: sourceUrl || 'https://open.spotify.com'
            }
        });
    } else {
        await ctx.waSock.sendMessage(ctx.from, { text: `🎵 *${plainText.title}*\n👤 ${plainText.body}`, edit: searchMsg.key });
    }
}

async function sendAudioUrl(ctx, url) {
    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    await ctx.waSock.sendMessage(ctx.from, { audio: buffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: ctx.msg });
}

// --- command handlers (ordered; first regex match wins) ---
const COMMANDS = [
{
    re: /^(files|list files|daftar file|my files)$/i,
    run: async (ctx) => {
        const rows = listLocalFiles(ctx.from, 20);
        if (rows.length === 0) return reply(ctx, "Belum ada file tersimpan di sesi ini.");
        const lines = rows.map((r, idx) => {
            const dt = r.date ? new Date(r.date).toLocaleString('id-ID') : "-";
            return `${idx + 1}. ${r.id} - ${r.filename || 'unnamed'} (${dt})`;
        });
        await reply(ctx, `📁 *Daftar File Tersimpan*\n\n${lines.join('\n')}\n\nKetik ID (5 digit) buat kirim ulang.`);
    }
},
{
    re: /^(?:delete|hapus)\s+file\s+(\d{5})$/i,
    run: async (ctx, m) => {
        const res = deleteLocalFileById(ctx.from, m[1]);
        if (!res.ok) return replyErr(ctx, "File ID tidak ditemukan.");
        await reply(ctx, `🗑️ File ${m[1]} (${res.filename}) berhasil dihapus.`);
    }
},
{
    re: /^(?:rename|ganti)\s+file\s+(\d{5})\s+(.+)$/i,
    run: async (ctx, m) => {
        const res = renameLocalFileById(ctx.from, m[1], m[2]);
        const map = {
            invalid_name: "Nama file baru tidak valid.",
            not_found: "File ID tidak ditemukan.",
            missing_file: "File fisik tidak ditemukan.",
            rename_failed: "Gagal rename file."
        };
        if (!res.ok) return replyErr(ctx, map[res.reason] || "Gagal rename file.");
        await reply(ctx, `✏️ File ${m[1]} berhasil diubah jadi: ${res.filename}`);
    }
},
{
    re: /^cancel[ _]confirm$/i,
    run: async (ctx) => {
        pendingSensitiveActions.delete(String(ctx.from));
        await reply(ctx, "✅ Pending aksi sensitif dibatalkan.");
    }
},
{
    re: /^confirm[:\s]+([A-Z0-9]{4,10})$/i,
    run: async (ctx, m) => {
        const pending = pendingSensitiveActions.get(String(ctx.from));
        if (!pending) return reply(ctx, "⚠️ Tidak ada aksi sensitif yang menunggu konfirmasi.");
        if (Date.now() - pending.createdAt > SENSITIVE_TTL_MS) {
            pendingSensitiveActions.delete(String(ctx.from));
            return reply(ctx, "⏱️ Token konfirmasi sudah expired. Minta ulang aksinya.");
        }
        if (pending.token.toLowerCase() !== m[1].toLowerCase()) return replyErr(ctx, "Token konfirmasi salah.");
        pendingSensitiveActions.delete(String(ctx.from));
        const execRes = await executeSensitiveAction(pending, ctx.from, ctx.waSock);
        await reply(ctx, execRes.ok ? `✅ ${execRes.text}` : `❌ ${execRes.text}`);
    }
},
{
    re: /^\.personality\b/i,
    run: async (ctx) => {
        const personalities = loadJsonConfig("./package/personalities.json", { active: "default", profiles: {} });
        const save = () => writeJsonConfig("./package/personalities.json", personalities);
        const sub = ctx.args[1]?.toLowerCase();

        if (sub === 'list') {
            let listMsg = "🎭 *Available Personalities:*\n\n";
            for (const key in personalities.profiles) {
                const p = personalities.profiles[key];
                listMsg += `${key === personalities.active ? '✅' : '▪️'} *${key}*: ${p.name}\n`;
            }
            await reply(ctx, listMsg + "\nUse `.personality select [key]` to switch.");
        } else if (sub === 'select') {
            const key = ctx.args[2]?.toLowerCase();
            if (!personalities.profiles[key]) return replyErr(ctx, `Personality *${key}* not found.`);
            personalities.active = key;
            save();
            await reply(ctx, `✅ Personality swapped to: *${personalities.profiles[key].name}*`);
        } else if (sub === 'add') {
            const [name, ...promptParts] = ctx.text.slice('.personality add'.length).trim().split('|');
            const prompt = promptParts.join('|').trim();
            const key = name?.trim().toLowerCase().replace(/\s+/g, '_');
            if (!key || !prompt) return reply(ctx, "❌ Format: `.personality add Name | Prompt Text`");
            personalities.profiles[key] = { name: name.trim(), prompt };
            save();
            await reply(ctx, `✨ New personality added: *${name.trim()}* (key: ${key})`);
        } else if (sub === 'delete') {
            const key = ctx.args[2]?.toLowerCase();
            if (key === 'default') return replyErr(ctx, "Cannot delete default personality.");
            if (!personalities.profiles[key]) return replyErr(ctx, `Personality *${key}* not found.`);
            delete personalities.profiles[key];
            if (personalities.active === key) personalities.active = 'default';
            save();
            await reply(ctx, `🗑️ Personality *${key}* deleted.`);
        } else {
            await reply(ctx, "❓ *Personality Commands:*\n.personality list\n.personality select [key]\n.personality add [Name] | [Prompt]\n.personality delete [key]");
        }
    }
},
{
    re: /^\.model\b/i,
    run: async (ctx) => {
        const sub = ctx.args[1]?.toLowerCase();
        const modelData = loadJsonConfig("./package/model.json", { defaultModel: "", availableModels: [] });

        if (sub === 'list') {
            let listMsg = "🤖 *Available AI Models:*\n\n";
            modelData.availableModels.forEach(m => {
                listMsg += `${m === modelData.defaultModel ? '✅' : '▪️'} ${m}\n`;
            });
            await reply(ctx, listMsg + "\nUse `.model select [NAME]` to switch.");
        } else if (sub === 'select') {
            const newModel = ctx.args[2]?.toLowerCase();
            const found = modelData.availableModels.find(m => m.toLowerCase() === newModel);
            if (!found) return replyErr(ctx, `Model *${newModel}* not found in list.`);
            modelData.defaultModel = found;
            writeJsonConfig("./package/model.json", modelData);
            await reply(ctx, `✅ AI Model swapped to: *${found}*`);
        } else {
            await reply(ctx, "❓ *Model Commands:*\n.model list\n.model select [NAME]");
        }
    }
},
{
    re: /^(reset|clear|hapus memory|baru)$/i,
    run: async (ctx) => {
        clearHistory(ctx.from);
        await reply(ctx, "✅ Memory direset. Mulai percakapan baru!");
    }
},
{
    re: /^\.search\s+(.+)$/i,
    run: async (ctx, m) => {
        const query = m[1].trim();
        const searchMsg = await ctx.waSock.sendMessage(ctx.from, { text: `🔍 Searching: ${query}...` });
        const result = await webSearch(query);
        if (!result.ok) return replyErr(ctx, result.error);
        await ctx.waSock.sendMessage(ctx.from, {
            text: `🔍 *Search: ${query}*\n\n${result.text}`,
            edit: searchMsg.key,
            footer: '✨ OpenXX Search'
        });
    }
},
{
    re: /^\.img\s+(.+)$/i,
    run: async (ctx, m) => {
        const prompt = m[1].trim();
        const genMsg = await ctx.waSock.sendMessage(ctx.from, { text: `🎨 Generating image: ${prompt}...` });
        const result = await generateImage(prompt);
        if (!result.ok) {
            await ctx.waSock.sendMessage(ctx.from, { delete: genMsg.key }).catch(() => {});
            return replyErr(ctx, result.error);
        }
        if (result.imageUrl) {
            const imageBuffer = await fetchBuffer(result.imageUrl);
            if (imageBuffer) {
                await ctx.waSock.sendMessage(ctx.from, {
                    image: imageBuffer,
                    caption: `🎨 *${prompt}*${result.text ? `\n\n${result.text}` : ''}`,
                    footer: '✨ OpenXX Image'
                });
            } else {
                await ctx.waSock.sendMessage(ctx.from, {
                    text: `🎨 *${prompt}*\n\n${result.text || 'Image generated but failed to download.'}\n\n🔗 ${result.imageUrl}`,
                    footer: '✨ OpenXX Image'
                });
            }
        } else if (result.text) {
            await ctx.waSock.sendMessage(ctx.from, { text: `🎨 *${prompt}*\n\n${result.text}`, footer: '✨ OpenXX Image' });
        }
        await ctx.waSock.sendMessage(ctx.from, { delete: genMsg.key }).catch(() => {});
    }
},
{
    re: /^(ram|memory|mem|status ram)$/i,
    run: async (ctx) => reply(ctx, getRamReport())
},
{
    re: /^ram (?:trend|history)$/i,
    run: async (ctx) => {
        const trend = getRamTrend();
        if (!trend) return reply(ctx, "⚠️ Belum cukup data (butuh minimal 2 reading)");
        await reply(ctx, `📈 *RAM Trend* (last ${trend.samples} min)\n\nAvg: ${trend.avg}%\nMax: ${trend.max}%\nMin: ${trend.min}%`);
    }
},
{
    re: /^(gc|garbage collect|bersihkan memory)$/i,
    run: async (ctx) => {
        const before = process.memoryUsage().heapUsed;
        if (!forceGarbageCollect()) return reply(ctx, "⚠️ GC tidak tersedia (jalankan dengan --expose-gc)");
        const freed = ((before - process.memoryUsage().heapUsed) / 1024 / 1024).toFixed(2);
        await reply(ctx, `🗑️ GC selesai. Freed: ${freed} MB`);
    }
},
{
    re: /^(stats|statistik|analytics)$/i,
    run: async (ctx) => {
        const s = getStatsSummary();
        await reply(ctx, `📊 *Statistics (Today)*\n\n` +
            `Messages: ${s.today.messages}\n` +
            `AI Calls: ${s.today.aiCalls}\n` +
            `Commands: ${s.today.commands}\n` +
            `Avg Response: ${s.today.avgResponseTime}ms\n\n` +
            `*Top Commands:*\n` +
            (s.topCommands.length > 0 ? s.topCommands.map(([cmd, count]) => `${cmd}: ${count}`).join('\n') : 'No commands used today'));
    }
},
{
    re: /^\.ai\b/i,
    run: async (ctx) => {
        const sub = ctx.args[1]?.toLowerCase();

        if (sub === 'status' || sub === 'list') return reply(ctx, getAIStatus());

        if (sub === 'url') {
            const baseUrl = ctx.args[2];
            if (!baseUrl) return reply(ctx, "❓ Usage: .ai url <base-url>\nContoh: .ai url https://openrouter.ai/api/v1");
            setMainBaseUrl(baseUrl);
            return reply(ctx, `✅ Base URL set to: ${baseUrl}`);
        }

        if (sub === 'switch') {
            const name = ctx.args[2];
            if (!name) {
                const list = listProfiles().map(p => `${p.active ? '✅' : '  '} ${p.name}: ${p.baseUrl}`).join('\n');
                return reply(ctx, `🔄 *Available Profiles*\n\n${list}\n\nCurrent: ${getActiveProfileName()}\nUsage: .ai switch <name>`);
            }
            if (!setActiveProfile(name)) return replyErr(ctx, `Profile "${name}" not found`);
            return reply(ctx, `✅ Switched to profile: ${name}`);
        }

        if (sub === 'save') {
            const name = ctx.args[2];
            if (!name) return reply(ctx, "❓ Usage: .ai save <profile-name>\nSaves current settings as a new profile");
            saveProfile(name);
            setActiveProfile(name);
            return reply(ctx, `✅ Profile "${name}" created and activated`);
        }

        if (sub === 'delete') {
            const name = ctx.args[2];
            if (!name) return reply(ctx, "❓ Usage: .ai delete <profile-name>");
            if (!deleteProfile(name)) return replyErr(ctx, `Cannot delete profile "${name}"`);
            return reply(ctx, `✅ Profile "${name}" deleted`);
        }

        if (sub === 'model') {
            const model = ctx.args.slice(2).join(' ');
            if (!model) return reply(ctx, "❓ Usage: .ai model <model-name>");
            setMainModel(model);
            return reply(ctx, `✅ Main AI model set to: ${model}`);
        }

        if (sub === 'apikey' || sub === 'key') {
            const apiKey = ctx.args.slice(2).join(' ').trim();
            if (!apiKey) return reply(ctx, "❓ Usage: .ai apikey <your-api-key>");
            setMainApiKey(apiKey);
            return reply(ctx, `✅ API Key set: ***${apiKey.slice(-4)}`);
        }

        if (sub === 'agent') {
            const [agentType, profileName] = ctx.args.slice(2);
            if (!agentType || !profileName) return reply(ctx, `❓ Usage: .ai agent <type> <profile-name>\nTypes: ${AGENT_TYPES.join(', ')}`);
            setAgentProfile(agentType, profileName);
            return reply(ctx, `✅ Agent ${agentType} → profile: ${profileName}`);
        }

        if (sub === 'agentkey') {
            const agentType = ctx.args[2];
            const apiKey = ctx.args.slice(3).join(' ').trim();
            if (!agentType || !apiKey) return reply(ctx, `❓ Usage: .ai agentkey <agent-type> <api-key>\nTypes: ${AGENT_TYPES.join(', ')}`);
            setAgentApiKey(agentType, apiKey);
            return reply(ctx, `✅ Agent ${agentType} API Key set: ***${apiKey.slice(-4)}`);
        }

        if (sub === 'phone') {
            const phone = ctx.args[2];
            if (!phone) return reply(ctx, "❓ Usage: .ai phone <number>\nExample: .ai phone 628123456789");
            envSet('OPENX_DEV_PHONE_NUMBER', phone);
            return reply(ctx, `✅ Phone number set to: ${phone}`);
        }

        await reply(ctx, "❓ *AI Commands:*\n.ai status — lihat config\n.ai switch <name> — switch profile\n.ai save <name> — save current as profile\n.ai delete <name> — delete profile\n.ai url <base-url> — set API base URL (OpenAI-compatible)\n.ai model <name> — set model\n.ai apikey <key> — set API key\n.ai agent <type> <profile> — set agent profile");
    }
},
{
    re: /^\.agent\b/i,
    run: async (ctx) => {
        const sub = ctx.args[1]?.toLowerCase();

        if (sub === 'status' || sub === 'list') return reply(ctx, `🤖 *Agents*\n\n${getAgentsStatus()}`);

        if (!sub) {
            return sendList(ctx.waSock, ctx.from, '🤖 *Select Agent*', 'Pilih agent untuk membantu task:', 'Pilih Agent', [
                { title: '📚 Learning', rows: [
                    { title: '📚 Homework', description: 'Bantu tugas sekolah', rowId: '.agent homework ' },
                    { title: '✍️ Essay', description: 'Bantu karangan', rowId: '.agent essay ' },
                    { title: '🧮 Solver', description: 'Selesaikan soal mat/fisika', rowId: '.agent solver ' }
                ]},
                { title: '💼 Productivity', rows: [
                    { title: '🔍 Research', description: 'Riset mendalam', rowId: '.agent research ' },
                    { title: '💻 Code', description: 'Tulis/debug kode', rowId: '.agent code ' },
                    { title: '🌐 Translate', description: 'Terjemah teks', rowId: '.agent translate ' },
                    { title: '📝 Summary', description: 'Rangkum teks panjang', rowId: '.agent summary ' }
                ]},
                { title: '👁️ Media', rows: [
                    { title: '👁️ Vision', description: 'Analisis gambar', rowId: '.agent vision ' }
                ]}
            ]);
        }

        if (AGENT_TYPES.includes(sub)) {
            const task = ctx.args.slice(2).join(' ').trim();
            if (!task) return reply(ctx, `❓ Usage: .agent ${sub} <task>\nExample: .agent homework hitung 2+2`);
            spawnAgent(sub, task, ctx.from, ctx.waSock);
            return;
        }

        await reply(ctx, `❓ *Agent Commands:*\n` + AGENT_TYPES.map(t => `.agent ${t} <task>`).join('\n') + `\n.agent status`);
    }
},
{
    re: /^\.openx\s+agentic\s+(on|off)$/i,
    run: async (ctx, m) => {
        const on = m[1].toLowerCase() === 'on';
        setAgentic(on);
        await reply(ctx, on ? '🤖 Agentic mode ON — AI uses higher-effort responses' : '🤖 Agentic mode OFF — AI responds normally');
    }
},
{
    re: /^\.openx\s+agentic$/i,
    run: async (ctx) => reply(ctx, `🤖 Agentic mode: ${isAgentic() ? 'ON' : 'OFF'}\n\nKetik .openx agentic on/off untuk toggle.`)
},
{
    re: /^\.group\s+approve$/i,
    run: async (ctx) => {
        if (!ctx.isGroup) return replyErr(ctx, "Group commands only work in groups.");
        setGroupApproved(ctx.from, true);
        await reply(ctx, "✅ AI approved for this group. AI will respond with 10-15s delay per chat.");
    }
},
{
    re: /^\.group\s+unapprove$/i,
    run: async (ctx) => {
        if (!ctx.isGroup) return replyErr(ctx, "Group commands only work in groups.");
        setGroupApproved(ctx.from, false);
        await reply(ctx, "❌ AI unapproved for this group. Use .openx <message> to chat.");
    }
},
{
    re: /^\.group\s+delay\s+(\d+)$/i,
    run: async (ctx, m) => {
        if (!ctx.isGroup) return replyErr(ctx, "Group commands only work in groups.");
        const delay = parseInt(m[1]);
        setGroupDelay(ctx.from, delay);
        await reply(ctx, `✅ AI delay set to ${delay} seconds`);
    }
},
{
    re: /^\.voice\b/i,
    run: async (ctx) => {
        const sub = ctx.args[1]?.toLowerCase();

        if (sub === 'list') {
            const voices = await getVoiceList();
            if (voices.length === 0) return reply(ctx, "⚠️ Tidak ada voice tersedia atau API key belum di-set.");
            return reply(ctx, `🎤 *Available Voices*\n\n${voices.map(v => `• ${v.name} (${v.voice_id})`).join('\n')}`);
        }

        if (sub === 'set') {
            const voiceId = ctx.args[2];
            if (!voiceId) return reply(ctx, "❓ Usage: .voice set <voice-id>\nKetik .voice list untuk melihat voice IDs");
            envSet('OPENX_TTS_VOICE', voiceId);
            return reply(ctx, `✅ Voice set to: ${voiceId}`);
        }

        const text = ctx.args.slice(1).join(' ').trim();
        if (!text) {
            return sendButtons(ctx.waSock, ctx.from, '🎤 *Voice Note*', [
                { id: '.voice list', text: '📋 List Voices' },
                { id: '.voice set ', text: '⚙️ Set Voice' }
            ], { footer: 'Atau ketik: .voice <text>' });
        }

        await reply(ctx, `🎤 Converting to voice...`);
        if (!await sendVoiceNote(ctx.waSock, ctx.from, text, ctx.msg)) {
            await reply(ctx, "⚠️ Gagal convert ke voice. Pastikan API key sudah di-set.");
        }
    }
},
{
    re: /^\.note\b/i,
    run: async (ctx) => {
        const sub = ctx.args[1]?.toLowerCase();

        if (sub === 'add') {
            const text = ctx.args.slice(2).join(' ').trim();
            if (!text) return reply(ctx, "❓ Usage: .note add <text>");
            const note = addNote(ctx.from, text);
            return reply(ctx, `✅ Note saved (ID: ${note.id})`);
        }
        if (sub === 'list') {
            const notes = listNotes(ctx.from);
            if (notes.length === 0) return reply(ctx, "📝 Belum ada catatan.");
            return reply(ctx, `📝 *Notes*\n\n${notes.map((n, i) => `${i + 1}. [${n.id}] ${n.text}`).join('\n')}`);
        }
        if (sub === 'search') {
            const query = ctx.args.slice(2).join(' ').trim();
            if (!query) return reply(ctx, "❓ Usage: .note search <query>");
            const notes = searchNotes(ctx.from, query);
            if (notes.length === 0) return reply(ctx, `🔍 Tidak ada catatan cocok "${query}".`);
            return reply(ctx, `🔍 *Search: ${query}*\n\n${notes.map((n, i) => `${i + 1}. [${n.id}] ${n.text}`).join('\n')}`);
        }
        if (sub === 'delete') {
            const noteId = ctx.args[2];
            if (!noteId) return reply(ctx, "❓ Usage: .note delete <id>");
            const ok = deleteNote(ctx.from, noteId);
            return reply(ctx, ok ? `🗑️ Note ${noteId} deleted.` : `❌ Note ${noteId} not found.`);
        }

        await sendButtons(ctx.waSock, ctx.from, '📝 *Note Commands*', [
            { id: '.note list', text: '📋 List Notes' },
            { id: '.note add ', text: '➕ Add Note' },
            { id: '.note search ', text: '🔍 Search' }
        ], { footer: 'Atau ketik .note <command>' });
    }
},
{
    re: /^\.reminder\b/i,
    run: async (ctx) => {
        const sub = ctx.args[1]?.toLowerCase();

        if (sub === 'list') {
            const reminders = listReminders(ctx.from);
            if (reminders.length === 0) return reply(ctx, "⏰ Belum ada reminder aktif.");
            return reply(ctx, `⏰ *Active Reminders*\n\n${reminders.map(r => `[${r.id}] ${r.time} - ${r.text}`).join('\n')}`);
        }
        if (sub === 'cancel') {
            const id = ctx.args[2];
            if (!id) return reply(ctx, "❓ Usage: .reminder cancel <id>");
            const ok = cancelReminder(ctx.from, id);
            return reply(ctx, ok ? `🗑️ Reminder ${id} cancelled.` : `❌ Reminder ${id} not found.`);
        }

        const text = ctx.args.slice(2).join(' ').trim();
        if (!sub || !text) return reply(ctx, "❓ Usage: .reminder <HH:MM> <text>");
        if (!/^\d{2}:\d{2}$/.test(sub)) return replyErr(ctx, "Format waktu harus HH:MM (contoh: 14:30)");
        const reminder = setReminder(ctx.from, sub, text);
        await reply(ctx, `⏰ Reminder set: ${sub}\n\n${text}\n\n(ID: ${reminder.id})`);
    }
},
{
    re: /^\.play\s+(.+)$/i,
    run: async (ctx, m) => {
        const input = m[1].trim();
        const searchMsg = await ctx.waSock.sendMessage(ctx.from, { text: `🔍 Searching: ${input}...` });
        const isUrl = input.startsWith('http://') || input.startsWith('https://');
        const result = isUrl ? await downloadByTrackUrl(input) : await downloadSong(input);
        if (!result.ok) return replyErr(ctx, result.error);

        try {
            await editNowPlaying(ctx, searchMsg, {
                title: '🎵 Now Playing',
                cover: result.image,
                plainText: { title: result.title || 'Unknown', body: `${result.artist || 'Unknown'}${result.album ? ` • ${result.album}` : ''}${result.duration ? ` • ${result.duration}` : ''}` }
            });
            if (result.downloadUrl) await sendAudioUrl(ctx, result.downloadUrl);
        } catch (e) {
            await replyErr(ctx, `Gagal play: ${e.message}`);
        }
    }
},
{
    re: /^\.spotify\s+(.+)$/i,
    run: async (ctx, m) => {
        const query = m[1].trim();
        const searchMsg = await ctx.waSock.sendMessage(ctx.from, { text: `🔍 Searching: ${query}...` });
        const result = await searchSongs(query, 5);
        if (!result.ok) return replyErr(ctx, result.error);

        const songs = Array.isArray(result.results) ? result.results : [];
        if (songs.length === 0) return reply(ctx, "🔍 Tidak ada hasil ditemukan.");

        const cacheIds = cacheSearchResults(songs);
        const first = songs[0];
        await editNowPlaying(ctx, searchMsg, {
            title: `🎵 Found ${songs.length} results`,
            cover: first.cover,
            sourceUrl: first.spotify_search_url,
            plainText: { title: first.title || 'Unknown', body: `${first.artists || 'Unknown'}${first.duration ? ` • ${first.duration}` : ''}\nTap ▶ Play untuk putar` }
        });

        const trackList = songs.map((s, i) => `${i + 1}. ${s.title || 'Unknown'} — ${s.artists || 'Unknown'} (${s.duration || ''})`).join('\n');
        await sendButtons(ctx.waSock, ctx.from, `🎵 *Search Results*\n\n${trackList}`, songs.slice(0, 4).map((s, i) => ({
            text: `▶ ${s.title?.slice(0, 15) || 'Play'}`,
            id: `playtrack:${cacheIds[i]}`
        })), { footer: '✨ OpenXX Music' });
    }
},
{
    re: /^playtrack:(.+)$/i,
    run: async (ctx, m) => {
        const track = getCachedTrack(m[1].trim());
        if (!track) return reply(ctx, "⚠️ Track expired. Cari ulang dengan .spotify");

        const title = track.title || track.name;
        const searchMsg = await ctx.waSock.sendMessage(ctx.from, { text: `🎵 Playing: ${title}...` });

        try {
            if (track.preview_url) {
                await editNowPlaying(ctx, searchMsg, {
                    title: '🎵 Now Playing',
                    cover: track.cover,
                    plainText: { title: title || 'Unknown', body: `${track.artists || 'Unknown'}${track.duration ? ` • ${track.duration}` : ''}` }
                });
                await sendAudioUrl(ctx, track.preview_url);
            } else {
                const dl = await downloadSong(title);
                if (dl.ok && dl.downloadUrl) {
                    await ctx.waSock.sendMessage(ctx.from, { text: `🎵 *${title}*`, edit: searchMsg.key });
                    await sendAudioUrl(ctx, dl.downloadUrl);
                }
            }
        } catch (e) {
            await replyErr(ctx, `Gagal play: ${e.message}`);
        }
    }
},
{
    re: /^\.album\s+(.+)$/i,
    run: async (ctx, m) => {
        const query = m[1].trim();
        await reply(ctx, `💿 Searching album: ${query}...`);
        const result = await searchSongs(query, 10);
        if (!result.ok) return replyErr(ctx, result.error);

        const songs = Array.isArray(result.results) ? result.results : [];
        if (songs.length === 0) return reply(ctx, "💿 Album tidak ditemukan.");

        const albumMap = new Map();
        for (const song of songs) {
            const album = song.album || 'Unknown Album';
            if (!albumMap.has(album)) albumMap.set(album, { cover: song.cover, tracks: [] });
            albumMap.get(album).tracks.push(song);
        }

        const [albumName, albumData] = albumMap.entries().next().value;
        const cacheIds = cacheSearchResults(albumData.tracks);
        const trackList = albumData.tracks.map((t, i) => `${i + 1}. ${t.title || t.name} — ${t.artists || 'Unknown'} (${t.duration || ''})`).join('\n');
        const header = `💿 *${albumName}*\n👤 ${albumData.tracks[0]?.artists || 'Unknown'}\n🎵 ${albumData.tracks.length} tracks`;

        if (albumData.cover) {
            await ctx.waSock.sendMessage(ctx.from, {
                album: [
                    { image: { url: albumData.cover }, caption: `${header}\n\n${trackList}` },
                    ...albumData.tracks.slice(0, 5).map((t, i) => ({
                        image: { url: t.cover || albumData.cover },
                        caption: `${i + 1}. ${t.title || t.name}\n⏱️ ${t.duration || ''}\nID: ${cacheIds[i]}`
                    }))
                ]
            }, { quoted: ctx.msg });
        } else {
            await ctx.waSock.sendMessage(ctx.from, {
                text: `${header}\n\n${trackList}\n\nKetik \`.play <judul>\` untuk putar.`,
                footer: '✨ OpenXX Music'
            }, { quoted: ctx.msg });
        }

        if (albumMap.size > 1) {
            await reply(ctx, `💡 Album lain ditemukan: ${[...albumMap.keys()].slice(1).join(', ')}\nKetik \`.album <nama album>\` untuk lihat spesifik.`);
        }
    }
},
{
    re: /^\.group\b/i,
    run: async (ctx) => {
        if (!ctx.isGroup) return replyErr(ctx, "Group commands only work in groups.");

        const sub = ctx.args[1]?.toLowerCase();
        const val = ctx.args[2]?.toLowerCase();
        const group = getGroup(ctx.from) || {};

        // simple on/off toggles
        const toggles = {
            spam: { field: 'spam_protection', on: 'Anti-spam', off: 'Anti-spam' },
            reply: { field: 'auto_reply_enabled', on: 'Auto-reply', off: 'Auto-reply' },
            ai: { field: 'ai_enabled', on: 'AI chat', off: 'AI chat' },
        };
        if (toggles[sub]) {
            const t = toggles[sub];
            if (val === 'on' || val === 'off') {
                setGroup(ctx.from, { [t.field]: val === 'on' });
                return reply(ctx, val === 'on' ? `✅ ${t.on} enabled.` : `❌ ${t.off} disabled.`);
            }
            return reply(ctx, `❓ Usage: .group ${sub} on/off`);
        }

        if (sub === 'settings') {
            return reply(ctx, [
                `⚙️ *Group Settings*`,
                `Welcome: ${group.welcome_enabled ? '✅ ON' : '❌ OFF'}`,
                `Welcome msg: ${group.welcome_message || '(default)'}`,
                `Anti-spam: ${group.spam_protection ? '✅ ON' : '❌ OFF'}`,
                `Auto-reply: ${group.auto_reply_enabled ? '✅ ON' : '❌ OFF'}`,
                `AI Chat: ${group.ai_enabled ? '✅ ON' : '❌ OFF'}`,
                `AI Keywords: ${(group.ai_keywords || ['bot', 'openx']).join(', ')}`,
                `Muted: ${group.muted ? '🔇 YES' : '🔊 NO'}`
            ].join('\n'));
        }
        if (sub === 'welcome') {
            if (val === 'on' || val === 'off') {
                setGroup(ctx.from, { welcome_enabled: val === 'on' });
                return reply(ctx, val === 'on' ? "✅ Welcome message enabled." : "❌ Welcome message disabled.");
            }
            const msgText = ctx.args.slice(2).join(' ');
            if (!msgText) return reply(ctx, "❓ Usage: .group welcome on/off/<message>");
            setGroup(ctx.from, { welcome_message: msgText });
            return reply(ctx, `✅ Welcome message set to:\n${msgText}`);
        }
        if (sub === 'mute' || sub === 'unmute') {
            setGroup(ctx.from, { muted: sub === 'mute' });
            return reply(ctx, sub === 'mute' ? "🔇 Bot muted in this group." : "🔊 Bot unmuted.");
        }
        if (sub === 'keyword') {
            const kw = ctx.args[3];
            const currentKw = group.ai_keywords || ['bot', 'openx'];
            if (val === 'add' && kw) {
                if (!currentKw.includes(kw.toLowerCase())) {
                    currentKw.push(kw.toLowerCase());
                    setGroup(ctx.from, { ai_keywords: currentKw });
                }
                return reply(ctx, `✅ Keywords: ${currentKw.join(', ')}`);
            }
            if (val === 'remove' && kw) {
                const idx = currentKw.indexOf(kw.toLowerCase());
                if (idx !== -1) currentKw.splice(idx, 1);
                setGroup(ctx.from, { ai_keywords: currentKw });
                return reply(ctx, `✅ Keywords: ${currentKw.join(', ')}`);
            }
            if (val === 'list') return reply(ctx, `📋 Keywords: ${currentKw.join(', ')}`);
            return reply(ctx, "❓ Usage: .group keyword add/remove/list <keyword>");
        }
        if (sub === 'train') {
            await reply(ctx, "🔄 Training group...");
            const result = await trainGroup(ctx.waSock, ctx.from);
            if (!result.ok) return replyErr(ctx, `Training failed: ${result.error}`);
            const d = result.data;
            return reply(ctx, [
                `✅ *Group Trained!*`,
                `📝 Name: ${d.name}`,
                `👥 Members: ${d.memberCount}`,
                d.description ? `📄 Description: ${d.description.slice(0, 100)}` : '',
                d.members?.length > 0 ? `\n*Members:*\n${d.members.slice(0, 10).map(m => `• ${m.name}${m.isAdmin ? ' (admin)' : ''}`).join('\n')}` : ''
            ].filter(Boolean).join('\n'));
        }
        if (sub === 'rule') {
            const ruleText = ctx.args.slice(3).join(' ').trim();
            if (val === 'add' && ruleText) {
                addGroupRule(ctx.from, ruleText);
                return reply(ctx, `✅ Rule added: ${ruleText}`);
            }
            if (val === 'remove' && ctx.args[3]) {
                return reply(ctx, removeGroupRule(ctx.from, ctx.args[3]) ? "✅ Rule removed" : "❌ Rule not found");
            }
            if (val === 'list') {
                const rules = getGroupTraining(ctx.from)?.rules || [];
                if (rules.length === 0) return reply(ctx, "📋 Belum ada rules.");
                return reply(ctx, `📋 *Rules:*\n\n${rules.map((r, i) => `${i + 1}. [${r.id}] ${r.text}`).join('\n')}`);
            }
            return reply(ctx, "❓ Usage: .group rule add/remove/list <rule text>");
        }
        if (sub === 'topic') {
            const topic = ctx.args.slice(3).join(' ').trim();
            if (val === 'add' && topic) {
                addGroupTopic(ctx.from, topic);
                return reply(ctx, `✅ Topic added: ${topic}`);
            }
            if (val === 'list') {
                const topics = getGroupTraining(ctx.from)?.topics || [];
                if (topics.length === 0) return reply(ctx, "📋 Belum ada topics.");
                return reply(ctx, `📋 *Topics:*\n${topics.join(', ')}`);
            }
            return reply(ctx, "❓ Usage: .group topic add/list <topic>");
        }
        if (sub === 'info') {
            if (!getGroupTraining(ctx.from)) return reply(ctx, "⚠️ Group belum di-train. Ketik `.group train` dulu.");
            return reply(ctx, `📋 *Group Info:*\n\n${getGroupContext(ctx.from)}`);
        }

        await reply(ctx, "❓ *Group Commands:*\n.group settings\n.group welcome on/off/<msg>\n.group spam on/off\n.group reply on/off\n.group mute/unmute\n.group ai on/off\n.group approve — AI auto-respond\n.group unapprove — disable AI\n.group delay <sec> — set response delay\n.group keyword add/remove/list\n.group train — train group info\n.group rule add/remove/list\n.group topic add/list\n.group info — view group context");
    }
},
];

export async function handleCommands(from, textMessage, msg, waSock) {
    const text = textMessage.trim().replace(/\s+/g, ' ');
    const ctx = {
        from, msg, waSock, text,
        args: text.split(' '),
        isGroup: from.endsWith('@g.us'),
    };

    for (const cmd of COMMANDS) {
        const m = cmd.re.exec(text);
        if (m) {
            try {
                await cmd.run(ctx, m);
            } catch (e) {
                await replyErr(ctx, e.message).catch(() => {});
            }
            return true;
        }
    }
    return false;
}
