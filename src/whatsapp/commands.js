import fs from 'fs';
import { loadJsonConfig, writeJsonConfig } from '../config.js';
import {
    listLocalFiles, deleteLocalFileById, renameLocalFileById
} from './helpers.js';
import { pendingSensitiveActions, executeSensitiveAction } from './sensitive-actions.js';
import { cancelBgTask, getBgStatusText } from './queue.js';
import { searchAndDownload } from './music-handler.js';
import { clearHistory } from './conversation-store.js';
import { getRamReport, getRamTrend, forceGarbageCollect } from './ram-monitor.js';
import { spawnAgent, listAgents, getAgentsStatus, AGENT_TYPES } from './agent-manager.js';
import { log } from '../logger.js';
import { getStatsSummary } from '../analytics.js';
import { handlePluginCommand, reloadPlugins } from '../plugin-manager.mjs';

const SENSITIVE_TTL_MS = 2 * 60 * 1000;

export async function handleCommands(from, textMessage, msg, waSock) {
    const lowerText = textMessage.trim().toLowerCase();

    // File Management Commands
    if (/^(files|list files|daftar file|my files)$/i.test(textMessage.trim())) {
        const rows = listLocalFiles(from, 20);
        if (rows.length === 0) {
            await waSock.sendMessage(from, { text: "Belum ada file tersimpan di sesi ini." }, { quoted: msg });
            return true;
        }
        const lines = rows.map((r, idx) => {
            const dt = r.date ? new Date(r.date).toLocaleString('id-ID') : "-";
            return `${idx + 1}. ${r.id} - ${r.filename || 'unnamed'} (${dt})`;
        });
        await waSock.sendMessage(from, { text: `📁 *Daftar File Tersimpan*\n\n${lines.join('\n')}\n\nKetik ID (5 digit) buat kirim ulang.` }, { quoted: msg });
        return true;
    }

    const deleteMatch = textMessage.trim().match(/^(?:delete|hapus)\s+file\s+(\d{5})$/i);
    if (deleteMatch) {
        const res = deleteLocalFileById(from, deleteMatch[1]);
        if (!res.ok) {
            await waSock.sendMessage(from, { text: "❌ File ID tidak ditemukan." }, { quoted: msg });
            return true;
        }
        await waSock.sendMessage(from, { text: `🗑️ File ${deleteMatch[1]} (${res.filename}) berhasil dihapus.` }, { quoted: msg });
        return true;
    }

    const renameMatch = textMessage.trim().match(/^(?:rename|ganti)\s+file\s+(\d{5})\s+(.+)$/i);
    if (renameMatch) {
        const res = renameLocalFileById(from, renameMatch[1], renameMatch[2]);
        if (!res.ok) {
            const map = {
                invalid_name: "Nama file baru tidak valid.",
                not_found: "File ID tidak ditemukan.",
                missing_file: "File fisik tidak ditemukan.",
                rename_failed: "Gagal rename file."
            };
            await waSock.sendMessage(from, { text: `❌ ${map[res.reason] || "Gagal rename file."}` }, { quoted: msg });
            return true;
        }
        await waSock.sendMessage(from, { text: `✏️ File ${renameMatch[1]} berhasil diubah jadi: ${res.filename}` }, { quoted: msg });
        return true;
    }

    const normalizedText = textMessage.trim();
    const normalizedForConfirm = normalizedText.replace(/\s+/g, ' ').trim();

    // Sensitive action confirmations
    if (/^cancel confirm$/i.test(normalizedForConfirm) || /^cancel_confirm$/i.test(normalizedForConfirm)) {
        pendingSensitiveActions.delete(String(from));
        await waSock.sendMessage(from, { text: "✅ Pending aksi sensitif dibatalkan." }, { quoted: msg });
        return true;
    }
    const confirmMatch =
        normalizedForConfirm.match(/^confirm\s+([A-Z0-9]{4,10})$/i) ||
        normalizedForConfirm.match(/^confirm:([A-Z0-9]{4,10})$/i);
    if (confirmMatch) {
        const pending = pendingSensitiveActions.get(String(from));
        if (!pending) {
            await waSock.sendMessage(from, { text: "⚠️ Tidak ada aksi sensitif yang menunggu konfirmasi." }, { quoted: msg });
            return true;
        }
        if (Date.now() - pending.createdAt > SENSITIVE_TTL_MS) {
            pendingSensitiveActions.delete(String(from));
            await waSock.sendMessage(from, { text: "⏱️ Token konfirmasi sudah expired. Minta ulang aksinya." }, { quoted: msg });
            return true;
        }
        if (pending.token.toLowerCase() !== confirmMatch[1].toLowerCase()) {
            await waSock.sendMessage(from, { text: "❌ Token konfirmasi salah." }, { quoted: msg });
            return true;
        }
        pendingSensitiveActions.delete(String(from));
        const execRes = await executeSensitiveAction(pending, from, waSock);
        await waSock.sendMessage(from, { text: execRes.ok ? `✅ ${execRes.text}` : `❌ ${execRes.text}` }, { quoted: msg });
        return true;
    }

    // Background queue controls
    if (/^(bg status|status bg|queue status)$/i.test(textMessage.trim())) {
        await waSock.sendMessage(from, { text: getBgStatusText() }, { quoted: msg });
        return true;
    }
    const bgCancelMatch = textMessage.trim().match(/^(?:bg cancel|cancel bg)\s*(\S+)?$/i);
    if (bgCancelMatch) {
        const selector = bgCancelMatch[1] || 'last';
        const res = cancelBgTask(selector);
        await waSock.sendMessage(from, { text: res.ok ? `✅ ${res.msg}` : `❌ ${res.msg}` }, { quoted: msg });
        return true;
    }

    // Personality Commands
    if (lowerText.startsWith('.personality')) {
        let personalities = loadJsonConfig("./package/personalities.json", { active: "default", profiles: {} });
        const args = textMessage.split(' ');
        const subCommand = args[1]?.toLowerCase();
        
        if (subCommand === 'list') {
            let listMsg = "🎭 *Available Personalities:*\n\n";
            for (const key in personalities.profiles) {
                const p = personalities.profiles[key];
                listMsg += `${key === personalities.active ? '✅' : '▪️'} *${key}*: ${p.name}\n`;
            }
            listMsg += "\nUse `.personality select [key]` to switch.";
            await waSock.sendMessage(from, { text: listMsg }, { quoted: msg });
        } else if (subCommand === 'select') {
            const key = args[2]?.toLowerCase();
            if (personalities.profiles[key]) {
                personalities.active = key;
                writeJsonConfig("./package/personalities.json", personalities);
                await waSock.sendMessage(from, { text: `✅ Personality swapped to: *${personalities.profiles[key].name}*` }, { quoted: msg });
            } else {
                await waSock.sendMessage(from, { text: `❌ Personality *${key}* not found.` }, { quoted: msg });
            }
        } else if (subCommand === 'add') {
            const content = textMessage.substring(16).trim();
            const [name, ...promptParts] = content.split('|');
            const prompt = promptParts.join('|').trim();
            const key = name.trim().toLowerCase().replace(/\s+/g, '_');
            if (key && prompt) {
                personalities.profiles[key] = { name: name.trim(), prompt: prompt };
                writeJsonConfig("./package/personalities.json", personalities);
                await waSock.sendMessage(from, { text: `✨ New personality added: *${name.trim()}* (key: ${key})` }, { quoted: msg });
            } else {
                await waSock.sendMessage(from, { text: "❌ Format: `.personality add Name | Prompt Text`" }, { quoted: msg });
            }
        } else if (subCommand === 'delete') {
            const key = args[2]?.toLowerCase();
            if (key === 'default') return await waSock.sendMessage(from, { text: "❌ Cannot delete default personality." });
            if (personalities.profiles[key]) {
                delete personalities.profiles[key];
                if (personalities.active === key) personalities.active = 'default';
                writeJsonConfig("./package/personalities.json", personalities);
                await waSock.sendMessage(from, { text: `🗑️ Personality *${key}* deleted.` }, { quoted: msg });
            } else {
                await waSock.sendMessage(from, { text: `❌ Personality *${key}* not found.` }, { quoted: msg });
            }
        } else {
            await waSock.sendMessage(from, { text: "❓ *Personality Commands:*\n.personality list\n.personality select [key]\n.personality add [Name] | [Prompt]\n.personality delete [key]" }, { quoted: msg });
        }
        return true;
    }

    // Model Commands
    if (lowerText.startsWith('.model')) {
        const args = textMessage.split(' ');
        const subCommand = args[1]?.toLowerCase();
        let modelData = loadJsonConfig("./package/model.json", { defaultModel: "", availableModels: [] });

        if (subCommand === 'list') {
            let listMsg = "🤖 *Available AI Models:*\n\n";
            modelData.availableModels.forEach(m => {
                listMsg += `${m === modelData.defaultModel ? '✅' : '▪️'} ${m}\n`;
            });
            listMsg += "\nUse `.model select [NAME]` to switch.";
            await waSock.sendMessage(from, { text: listMsg }, { quoted: msg });
        } else if (subCommand === 'select') {
            const newModel = args[2]?.toLowerCase();
            const found = modelData.availableModels.find(m => m.toLowerCase() === newModel);
            if (found) {
                modelData.defaultModel = found;
                writeJsonConfig("./package/model.json", modelData);
                await waSock.sendMessage(from, { text: `✅ AI Model swapped to: *${found}*` }, { quoted: msg });
            } else {
                await waSock.sendMessage(from, { text: `❌ Model *${newModel}* not found in list.` }, { quoted: msg });
            }
        } else {
            await waSock.sendMessage(from, { text: "❓ *Model Commands:*\n.model list\n.model select [NAME]" }, { quoted: msg });
        }
        return true;
    }

    // Reset Conversation History
    if (/^(reset|clear|hapus memory| baru)$/i.test(textMessage.trim())) {
        clearHistory(from);
        await waSock.sendMessage(from, { text: "✅ Memory direset. Mulai percakapan baru!" }, { quoted: msg });
        return true;
    }

    // RAM Monitor
    if (/^(ram|memory|mem|status ram)$/i.test(textMessage.trim())) {
        const report = getRamReport();
        await waSock.sendMessage(from, { text: report }, { quoted: msg });
        return true;
    }

    // Agent Commands
    if (/^\.agent\b/i.test(textMessage.trim())) {
        const args = textMessage.trim().split(/\s+/);
        const sub = args[1]?.toLowerCase();

        if (sub === 'status' || sub === 'list') {
            const status = getAgentsStatus();
            await waSock.sendMessage(from, { text: `🤖 *Agents*\n\n${status}` }, { quoted: msg });
            return true;
        }

        if (['research', 'code', 'translate', 'summary', 'homework', 'essay', 'solver', 'vision'].includes(sub)) {
            const task = args.slice(2).join(' ').trim();
            if (!task) {
                await waSock.sendMessage(from, { text: `❓ Usage: .agent ${sub} <task>` }, { quoted: msg });
                return true;
            }
            spawnAgent(sub, task, from, waSock);
            return true;
        }

        await waSock.sendMessage(from, {
            text: `❓ *Agent Commands:*\n.agent research <task> — riset\n.agent code <task> — coding\n.agent translate <task> — terjemah\n.agent summary <task> — rangkum\n.agent homework <task> — tugas sekolah\n.agent essay <task> — karangan\n.agent solver <task> — soal mat/fisika\n.agent vision <task> — analisis gambar\n.agent status`
        }, { quoted: msg });
        return true;
    }

    // RAM Trend
    if (/^(ram trend|ram history)$/i.test(textMessage.trim())) {
        const trend = getRamTrend();
        if (!trend) {
            await waSock.sendMessage(from, { text: "⚠️ Belum cukup data (butuh minimal 2 reading)" }, { quoted: msg });
        } else {
            const msg_text = `📈 *RAM Trend* (last ${trend.samples} min)\n\nAvg: ${trend.avg}%\nMax: ${trend.max}%\nMin: ${trend.min}%`;
            await waSock.sendMessage(from, { text: msg_text }, { quoted: msg });
        }
        return true;
    }

    // Force GC
    if (/^(gc|garbage collect|bersihkan memory)$/i.test(textMessage.trim())) {
        const before = process.memoryUsage().heapUsed;
        const ok = forceGarbageCollect();
        if (ok) {
            const after = process.memoryUsage().heapUsed;
            const freed = ((before - after) / 1024 / 1024).toFixed(2);
            await waSock.sendMessage(from, { text: `🗑️ GC selesai. Freed: ${freed} MB` }, { quoted: msg });
        } else {
            await waSock.sendMessage(from, { text: "⚠️ GC tidak tersedia (jalankan dengan --expose-gc)" }, { quoted: msg });
        }
        return true;
    }

    // Analytics Stats
    if (/^(stats|statistik|analytics)$/i.test(textMessage.trim())) {
        const stats = getStatsSummary();
        const msg_text = `📊 *Statistics (Today)*\n\n` +
            `Messages: ${stats.today.messages}\n` +
            `AI Calls: ${stats.today.aiCalls}\n` +
            `Commands: ${stats.today.commands}\n` +
            `Errors: ${stats.today.errors}\n` +
            `Avg Response: ${stats.today.avgResponseTime}ms\n\n` +
            `*Top Commands:*\n` +
            (stats.topCommands.length > 0
                ? stats.topCommands.map(([cmd, count]) => `${cmd}: ${count}`).join('\n')
                : 'No commands used today');
        await waSock.sendMessage(from, { text: msg_text }, { quoted: msg });
        return true;
    }

    // Music Player
    const playMatch = textMessage.trim().match(/^\.play\s+(.+)$/i);
    if (playMatch) {
        const query = playMatch[1].trim();
        const apikey = process.env.OPENX_MUSIC_API_KEY || '';

        if (!apikey) {
            await waSock.sendMessage(from, { text: "❌ Music API key not set." }, { quoted: msg });
            return true;
        }

        await waSock.sendMessage(from, { text: `🎵 Searching: ${query}...` }, { quoted: msg });

        const result = await searchAndDownload(query, apikey);

        if (!result.ok) {
            await waSock.sendMessage(from, { text: `❌ ${result.error}` }, { quoted: msg });
            return true;
        }

        try {
            const audioRes = await fetch(result.audioUrl);
            const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

            const caption = `🎵 *${result.title}*\n📺 ${result.channel}\n⏱️ ${result.duration}`;
            await waSock.sendMessage(from, {
                audio: audioBuffer,
                mimetype: 'audio/mpeg',
                ptt: false
            }, { quoted: msg });

            await waSock.sendMessage(from, { text: caption }, { quoted: msg });
        } catch (e) {
            await waSock.sendMessage(from, { text: `❌ Gagal download audio: ${e.message}` }, { quoted: msg });
        }

        return true;
    }

    // Group Management Commands
    if (lowerText.startsWith('.group')) {
        const isGroup = from.endsWith('@g.us');
        if (!isGroup) {
            await waSock.sendMessage(from, { text: "❌ Group commands only work in groups." }, { quoted: msg });
            return true;
        }

        const args = textMessage.trim().split(/\s+/);
        const sub = args[1]?.toLowerCase();
        const group = getGroup(from) || {};

        if (sub === 'settings') {
            const status = [
                `⚙️ *Group Settings*`,
                `Welcome: ${group.welcome_enabled ? '✅ ON' : '❌ OFF'}`,
                `Welcome msg: ${group.welcome_message || '(default)'}`,
                `Anti-spam: ${group.spam_protection ? '✅ ON' : '❌ OFF'}`,
                `Auto-reply: ${group.auto_reply_enabled ? '✅ ON' : '❌ OFF'}`,
                `AI Chat: ${group.ai_enabled ? '✅ ON' : '❌ OFF'}`,
                `AI Keywords: ${(group.ai_keywords || ['bot', 'openx']).join(', ')}`,
                `Muted: ${group.muted ? '🔇 YES' : '🔊 NO'}`
            ].join('\n');
            await waSock.sendMessage(from, { text: status }, { quoted: msg });
        } else if (sub === 'welcome') {
            const val = args[2]?.toLowerCase();
            if (val === 'on') {
                setGroup(from, { welcome_enabled: true });
                await waSock.sendMessage(from, { text: "✅ Welcome message enabled." }, { quoted: msg });
            } else if (val === 'off') {
                setGroup(from, { welcome_enabled: false });
                await waSock.sendMessage(from, { text: "❌ Welcome message disabled." }, { quoted: msg });
            } else {
                const msgText = args.slice(2).join(' ');
                if (msgText) {
                    setGroup(from, { welcome_message: msgText });
                    await waSock.sendMessage(from, { text: `✅ Welcome message set to:\n${msgText}` }, { quoted: msg });
                } else {
                    await waSock.sendMessage(from, { text: "❓ Usage: .group welcome on/off/<message>" }, { quoted: msg });
                }
            }
        } else if (sub === 'spam') {
            const val = args[2]?.toLowerCase();
            if (val === 'on') {
                setGroup(from, { spam_protection: true });
                await waSock.sendMessage(from, { text: "✅ Anti-spam enabled." }, { quoted: msg });
            } else if (val === 'off') {
                setGroup(from, { spam_protection: false });
                await waSock.sendMessage(from, { text: "❌ Anti-spam disabled." }, { quoted: msg });
            } else {
                await waSock.sendMessage(from, { text: "❓ Usage: .group spam on/off" }, { quoted: msg });
            }
        } else if (sub === 'reply') {
            const val = args[2]?.toLowerCase();
            if (val === 'on') {
                setGroup(from, { auto_reply_enabled: true });
                await waSock.sendMessage(from, { text: "✅ Auto-reply enabled." }, { quoted: msg });
            } else if (val === 'off') {
                setGroup(from, { auto_reply_enabled: false });
                await waSock.sendMessage(from, { text: "❌ Auto-reply disabled." }, { quoted: msg });
            } else {
                await waSock.sendMessage(from, { text: "❓ Usage: .group reply on/off" }, { quoted: msg });
            }
        } else if (sub === 'mute') {
            setGroup(from, { muted: true });
            await waSock.sendMessage(from, { text: "🔇 Bot muted in this group." }, { quoted: msg });
        } else if (sub === 'unmute') {
            setGroup(from, { muted: false });
            await waSock.sendMessage(from, { text: "🔊 Bot unmuted." }, { quoted: msg });
        } else if (sub === 'ai') {
            const val = args[2]?.toLowerCase();
            if (val === 'on') {
                setGroup(from, { ai_enabled: true });
                await waSock.sendMessage(from, { text: "✅ AI chat enabled in this group." }, { quoted: msg });
            } else if (val === 'off') {
                setGroup(from, { ai_enabled: false });
                await waSock.sendMessage(from, { text: "❌ AI chat disabled in this group." }, { quoted: msg });
            } else {
                await waSock.sendMessage(from, { text: "❓ Usage: .group ai on/off" }, { quoted: msg });
            }
        } else if (sub === 'keyword') {
            const action = args[2]?.toLowerCase();
            const kw = args[3];
            const currentKw = group.ai_keywords || ['bot', 'openx'];
            if (action === 'add' && kw) {
                if (!currentKw.includes(kw.toLowerCase())) {
                    currentKw.push(kw.toLowerCase());
                    setGroup(from, { ai_keywords: currentKw });
                }
                await waSock.sendMessage(from, { text: `✅ Keywords: ${currentKw.join(', ')}` }, { quoted: msg });
            } else if (action === 'remove' && kw) {
                const idx = currentKw.indexOf(kw.toLowerCase());
                if (idx !== -1) currentKw.splice(idx, 1);
                setGroup(from, { ai_keywords: currentKw });
                await waSock.sendMessage(from, { text: `✅ Keywords: ${currentKw.join(', ')}` }, { quoted: msg });
            } else if (action === 'list') {
                await waSock.sendMessage(from, { text: `📋 Keywords: ${currentKw.join(', ')}` }, { quoted: msg });
            } else {
                await waSock.sendMessage(from, { text: "❓ Usage: .group keyword add/remove/list <keyword>" }, { quoted: msg });
            }
        } else {
            await waSock.sendMessage(from, { text: "❓ *Group Commands:*\n.group settings\n.group welcome on/off/<msg>\n.group spam on/off\n.group reply on/off\n.group mute/unmute\n.group ai on/off\n.group keyword add/remove/list <kw>" }, { quoted: msg });
        }
        return true;
    }

    // Plugin Commands
    if (lowerText.startsWith('.plugin')) {
        const result = await handlePluginCommand(from, textMessage.trim());
        if (result) return true;
    }

    return false; // Not handled
}
