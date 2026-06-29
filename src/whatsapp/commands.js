import fs from 'fs';
import { loadJsonConfig, writeJsonConfig } from '../config.js';
import {
    listLocalFiles, deleteLocalFileById, renameLocalFileById
} from './helpers.js';
import { pendingSensitiveActions, executeSensitiveAction } from './sensitive-actions.js';
import { cancelBgTask, getBgStatusText } from './queue.js';
import { searchAndDownload } from './music-handler.js';
import { log } from '../logger.js';

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

    return false; // Not handled
}
