import fs from 'fs';
import { loadJsonConfig, writeJsonConfig } from '../config.js';
import {
    listLocalFiles, deleteLocalFileById, renameLocalFileById, fetchBuffer
} from './helpers.js';
import { webSearch } from './web-search.js';
import { generateImage } from './image-gen.js';
import { pendingSensitiveActions, executeSensitiveAction } from './sensitive-actions.js';
import { cancelBgTask, getBgStatusText } from './queue.js';
import { downloadSong, searchSongs, downloadByTrackUrl } from './music-handler.js';
import { cacheSearchResults, getCachedTrack } from './track-cache.js';
import { clearHistory } from './conversation-store.js';
import { getRamReport, getRamTrend, forceGarbageCollect } from './ram-monitor.js';
import { spawnAgent, getAgentsStatus } from './agent-manager.js';
import { getAIConfig, setMainProvider, setMainModel, setMainApiKey, setAgentApiKey, getAIStatus, getActiveProfileName, setActiveProfile, saveProfile, listProfiles, deleteProfile, setAgentProfile, isAgentic, setAgentic, toggleAgentic } from '../ai-config.js';
import { log } from '../logger.js';
import { getStatsSummary } from '../analytics.js';
import { handlePluginCommand } from '../plugin-manager.mjs';
import { sendButtons, sendList, sendPoll, sendCarousel } from './interactive.js';
import { addNote, listNotes, deleteNote, searchNotes } from './notes.js';
import { setReminder, listReminders, cancelReminder } from './reminders.js';
import { sendVoiceNote, getVoiceList } from './voice-handler.js';
import { getGroup, setGroup } from './group-manager.js';
import { trainGroup, addGroupRule, removeGroupRule, addGroupTopic, getGroupContext, getGroupTraining, listGroups } from './group-training.js';

const SENSITIVE_TTL_MS = 2 * 60 * 1000;

export async function handleCommands(from, textMessage, msg, waSock) {
    const lowerText = textMessage.trim().toLowerCase();
    const isGroup = from.endsWith('@g.us');

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

    // Web Search
    const searchCmdMatch = textMessage.trim().match(/^\.search\s+(.+)$/i);
    if (searchCmdMatch) {
        const query = searchCmdMatch[1].trim();
        const searchMsg = await waSock.sendMessage(from, { text: `🔍 Searching: ${query}...` });

        const result = await webSearch(query);

        if (!result.ok) {
            await waSock.sendMessage(from, { text: `❌ ${result.error}` }, { quoted: msg });
            return true;
        }

        // Edit message with results
        await waSock.sendMessage(from, {
            text: `🔍 *Search: ${query}*\n\n${result.text}`,
            edit: searchMsg.key,
            footer: '✨ OpenXX Search'
        });

        return true;
    }

    // Image Generation
    const imgGenMatch = textMessage.trim().match(/^\.img\s+(.+)$/i);
    if (imgGenMatch) {
        const prompt = imgGenMatch[1].trim();
        const genMsg = await waSock.sendMessage(from, { text: `🎨 Generating image: ${prompt}...` });

        const result = await generateImage(prompt);

        if (!result.ok) {
            await waSock.sendMessage(from, { text: `❌ ${result.error}` }, { quoted: msg });
            return true;
        }

        // Send generated image
        if (result.imageUrl) {
            try {
                const imageBuffer = await fetchBuffer(result.imageUrl);
                if (imageBuffer) {
                    await waSock.sendMessage(from, {
                        image: imageBuffer,
                        caption: `🎨 *${prompt}*${result.text ? `\n\n${result.text}` : ''}`,
                        footer: '✨ OpenXX Image'
                    });
                } else {
                    await waSock.sendMessage(from, {
                        text: `🎨 *${prompt}*\n\n${result.text || 'Image generated but failed to download.'}\n\n🔗 ${result.imageUrl}`,
                        footer: '✨ OpenXX Image'
                    });
                }
            } catch (e) {
                await waSock.sendMessage(from, {
                    text: `🎨 *${prompt}*\n\n${result.text || ''}\n\n🔗 ${result.imageUrl}`,
                    footer: '✨ OpenXX Image'
                });
            }
        } else if (result.text) {
            await waSock.sendMessage(from, {
                text: `🎨 *${prompt}*\n\n${result.text}`,
                footer: '✨ OpenXX Image'
            });
        }

        // Delete generating message
        try {
            await waSock.sendMessage(from, { delete: genMsg.key });
        } catch {}

        return true;
    }

    // RAM Monitor
    if (/^(ram|memory|mem|status ram)$/i.test(textMessage.trim())) {
        const report = getRamReport();
        await waSock.sendMessage(from, { text: report }, { quoted: msg });
        return true;
    }

    // AI Config Commands
    if (/^\.ai\b/i.test(textMessage.trim())) {
        const args = textMessage.trim().split(/\s+/);
        const sub = args[1]?.toLowerCase();

        if (sub === 'status' || sub === 'list') {
            const status = getAIStatus();
            await sendButtons(waSock, from, status, [
                { id: 'provider-openai', text: '🌐 OpenAI' },
                { id: 'provider-claude', text: '🧠 Claude' },
                { id: 'provider-chatgpt', text: '💬 ChatGPT' },
                { id: 'provider-gemini', text: '✨ Gemini' }
            ], { footer: 'Tap to switch provider' });
            return true;
        }

        if (sub === 'provider') {
            const provider = args[2];
            if (!provider) {
                // Show available profiles
                const profiles = listProfiles();
                const buttons = profiles.map(p => ({
                    id: `switch-${p.name}`,
                    text: `${p.active ? '✅ ' : ''}${p.name}`
                }));
                await sendButtons(waSock, from, '🤖 *Switch AI Provider*\nCurrent: ' + getActiveProfileName(), buttons.slice(0, 5), { footer: 'Atau: .ai switch <name>' });
                return true;
            }
            setMainProvider(provider);
            await waSock.sendMessage(from, { text: `✅ Provider set to: ${provider}` }, { quoted: msg });
            return true;
        }

        if (sub === 'switch') {
            const name = args[2];
            if (!name) {
                const profiles = listProfiles();
                const list = profiles.map(p => `${p.active ? '✅' : '  '} ${p.name}: ${p.provider}`).join('\n');
                await waSock.sendMessage(from, { text: `🔄 *Available Profiles*\n\n${list}\n\nUsage: .ai switch <name>` }, { quoted: msg });
                return true;
            }
            if (setActiveProfile(name)) {
                await waSock.sendMessage(from, { text: `✅ Switched to profile: ${name}` }, { quoted: msg });
            } else {
                await waSock.sendMessage(from, { text: `❌ Profile "${name}" not found` }, { quoted: msg });
            }
            return true;
        }

        if (sub === 'save') {
            const name = args[2];
            if (!name) {
                await waSock.sendMessage(from, { text: "❓ Usage: .ai save <profile-name>\nSaves current settings as a new profile" }, { quoted: msg });
                return true;
            }
            saveProfile(name, {});
            setActiveProfile(name);
            await waSock.sendMessage(from, { text: `✅ Profile "${name}" created and activated` }, { quoted: msg });
            return true;
        }

        if (sub === 'delete') {
            const name = args[2];
            if (!name) {
                await waSock.sendMessage(from, { text: "❓ Usage: .ai delete <profile-name>" }, { quoted: msg });
                return true;
            }
            if (deleteProfile(name)) {
                await waSock.sendMessage(from, { text: `✅ Profile "${name}" deleted` }, { quoted: msg });
            } else {
                await waSock.sendMessage(from, { text: `❌ Cannot delete profile "${name}"` }, { quoted: msg });
            }
            return true;
        }

        if (sub === 'model') {
            const model = args.slice(2).join(' ');
            if (!model) {
                await waSock.sendMessage(from, { text: "❓ Usage: .ai model <model-name>" }, { quoted: msg });
                return true;
            }
            setMainModel(model);
            await waSock.sendMessage(from, { text: `✅ Main AI model set to: ${model}` }, { quoted: msg });
            return true;
        }

        if (sub === 'agent') {
            const agentType = args[2];
            const profileName = args[3];
            if (!agentType || !profileName) {
                await waSock.sendMessage(from, { text: "❓ Usage: .ai agent <type> <profile-name>\nTypes: research, code, translate, summary, homework, essay, solver, vision" }, { quoted: msg });
                return true;
            }
            setAgentProfile(agentType, profileName);
            await waSock.sendMessage(from, { text: `✅ Agent ${agentType} → profile: ${profileName}` }, { quoted: msg });
            return true;
        }

        if (sub === 'apikey' || sub === 'key') {
            const apiKey = args.slice(2).join(' ').trim();
            if (!apiKey) {
                await waSock.sendMessage(from, { text: "❓ Usage: .ai apikey <your-api-key>" }, { quoted: msg });
                return true;
            }
            setMainApiKey(apiKey);
            await waSock.sendMessage(from, { text: `✅ API Key set: ***${apiKey.slice(-4)}` }, { quoted: msg });
            return true;
        }

        if (sub === 'phone') {
            const phone = args[2]?.trim();
            if (!phone) {
                await waSock.sendMessage(from, { text: "❓ Usage: .ai phone <number>\nExample: .ai phone 628123456789" }, { quoted: msg });
                return true;
            }
            // Update .env directly
            const fs = await import('fs');
            let env = fs.readFileSync('./.env', 'utf-8');
            env = env.replace(/^OPENX_DEV_PHONE_NUMBER=.*/m, `OPENX_DEV_PHONE_NUMBER=${phone}`);
            fs.writeFileSync('./.env', env);
            process.env.OPENX_DEV_PHONE_NUMBER = phone;
            await waSock.sendMessage(from, { text: `✅ Phone number set to: ${phone}` }, { quoted: msg });
            return true;
        }

        if (sub === 'agentkey') {
            const agentType = args[2];
            const apiKey = args.slice(3).join(' ').trim();
            if (!agentType || !apiKey) {
                await waSock.sendMessage(from, { text: "❓ Usage: .ai agentkey <agent-type> <api-key>\nTypes: research, code, translate, summary, homework, essay, solver, vision" }, { quoted: msg });
                return true;
            }
            setAgentApiKey(agentType, apiKey);
            await waSock.sendMessage(from, { text: `✅ Agent ${agentType} API Key set: ***${apiKey.slice(-4)}` }, { quoted: msg });
            return true;
        }

        await waSock.sendMessage(from, {
            text: `❓ *AI Commands:*\n.ai status — lihat config\n.ai switch <name> — switch profile\n.ai save <name> — save current as profile\n.ai delete <name> — delete profile\n.ai provider <name> — set provider\n.ai model <name> — set model\n.ai apikey <key> — set API key\n.ai agent <type> <profile> — set agent profile`
        }, { quoted: msg });
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

        if (!sub) {
            // Show agent selection with list
            await sendList(waSock, from, '🤖 *Select Agent*', 'Pilih agent untuk membantu task:', 'Pilih Agent', [
                {
                    title: '📚 Learning',
                    rows: [
                        { title: '📚 Homework', description: 'Bantu tugas sekolah', rowId: '.agent homework ' },
                        { title: '✍️ Essay', description: 'Bantu karangan', rowId: '.agent essay ' },
                        { title: '🧮 Solver', description: 'Selesaikan soal mat/fisika', rowId: '.agent solver ' }
                    ]
                },
                {
                    title: '💼 Productivity',
                    rows: [
                        { title: '🔍 Research', description: 'Riset mendalam', rowId: '.agent research ' },
                        { title: '💻 Code', description: 'Tulis/debug kode', rowId: '.agent code ' },
                        { title: '🌐 Translate', description: 'Terjemah teks', rowId: '.agent translate ' },
                        { title: '📝 Summary', description: 'Rangkum teks panjang', rowId: '.agent summary ' }
                    ]
                },
                {
                    title: '👁️ Media',
                    rows: [
                        { title: '👁️ Vision', description: 'Analisis gambar', rowId: '.agent vision ' }
                    ]
                }
            ]);
            return true;
        }

        if (['research', 'code', 'translate', 'summary', 'homework', 'essay', 'solver', 'vision'].includes(sub)) {
            const task = args.slice(2).join(' ').trim();
            if (!task) {
                await waSock.sendMessage(from, { text: `❓ Usage: .agent ${sub} <task>\nExample: .agent homework hitung 2+2` }, { quoted: msg });
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

    // Agentic Mode Toggle
    if (/^\.openx\s+agentic\s+(on|off)$/i.test(textMessage.trim())) {
        const value = textMessage.trim().toLowerCase().includes('on');
        setAgentic(value);
        await waSock.sendMessage(from, { text: value ? '🤖 Agentic mode ON — AI can use tools automatically' : '🤖 Agentic mode OFF — AI responds normally' }, { quoted: msg });
        return true;
    }

    if (/^\.openx\s+agentic$/i.test(textMessage.trim())) {
        const current = isAgentic();
        await waSock.sendMessage(from, { text: `🤖 Agentic mode: ${current ? 'ON' : 'OFF'}\n\nKetik .openx agentic on/off untuk toggle.` }, { quoted: msg });
        return true;
    }

    // Group AI Approval
    if (/^\.group\s+approve$/i.test(textMessage.trim())) {
        if (!isGroup) {
            await waSock.sendMessage(from, { text: "❌ Group commands only work in groups." }, { quoted: msg });
            return true;
        }
        setGroupApproved(from, true);
        await waSock.sendMessage(from, { text: "✅ AI approved for this group. AI will respond with 10-15s delay per chat." }, { quoted: msg });
        return true;
    }

    if (/^\.group\s+unapprove$/i.test(textMessage.trim())) {
        if (!isGroup) {
            await waSock.sendMessage(from, { text: "❌ Group commands only work in groups." }, { quoted: msg });
            return true;
        }
        setGroupApproved(from, false);
        await waSock.sendMessage(from, { text: "❌ AI unapproved for this group. Use .openx <message> to chat." }, { quoted: msg });
        return true;
    }

    if (/^\.group\s+delay\s+(\d+)$/i.test(textMessage.trim())) {
        if (!isGroup) {
            await waSock.sendMessage(from, { text: "❌ Group commands only work in groups." }, { quoted: msg });
            return true;
        }
        const delay = parseInt(textMessage.trim().match(/\.group\s+delay\s+(\d+)/i)[1]);
        setGroupDelay(from, delay);
        await waSock.sendMessage(from, { text: `✅ AI delay set to ${delay} seconds` }, { quoted: msg });
        return true;
    }

    // Voice Commands
    if (/^\.voice\b/i.test(textMessage.trim())) {
        const args = textMessage.trim().split(/\s+/);
        const sub = args[1]?.toLowerCase();

        if (sub === 'list') {
            const voices = await getVoiceList();
            if (voices.length === 0) {
                await waSock.sendMessage(from, { text: "⚠️ Tidak ada voice tersedia atau API key belum di-set." }, { quoted: msg });
            } else {
                const lines = voices.map(v => `• ${v.name} (${v.voice_id})`).join('\n');
                await waSock.sendMessage(from, { text: `🎤 *Available Voices*\n\n${lines}` }, { quoted: msg });
            }
            return true;
        }

        if (sub === 'set') {
            const voiceId = args[2];
            if (!voiceId) {
                await waSock.sendMessage(from, { text: "❓ Usage: .voice set <voice-id>\nKetik .voice list untuk melihat voice IDs" }, { quoted: msg });
                return true;
            }
            // Save to .env
            const fs = await import('fs');
            let env = fs.readFileSync('./.env', 'utf-8');
            if (env.includes('OPENX_TTS_VOICE=')) {
                env = env.replace(/OPENX_TTS_VOICE=.*/m, `OPENX_TTS_VOICE=${voiceId}`);
            } else {
                env += `\nOPENX_TTS_VOICE=${voiceId}\n`;
            }
            fs.writeFileSync('./.env', env);
            process.env.OPENX_TTS_VOICE = voiceId;
            await waSock.sendMessage(from, { text: `✅ Voice set to: ${voiceId}` }, { quoted: msg });
            return true;
        }

        // Convert text to voice
        const text = args.slice(1).join(' ').trim();
        if (!text) {
            await sendButtons(waSock, from, '🎤 *Voice Note*', [
                { id: '.voice list', text: '📋 List Voices' },
                { id: '.voice set ', text: '⚙️ Set Voice' }
            ], { footer: 'Atau ketik: .voice <text>' });
            return true;
        }

        await waSock.sendMessage(from, { text: `🎤 Converting to voice...` }, { quoted: msg });
        const success = await sendVoiceNote(waSock, from, text, msg);
        if (!success) {
            await waSock.sendMessage(from, { text: "⚠️ Gagal convert ke voice. Pastikan API key sudah di-set." }, { quoted: msg });
        }
        return true;
    }

    // Notes Commands
    if (lowerText.startsWith('.note')) {
        const args = textMessage.trim().split(/\s+/);
        const sub = args[1]?.toLowerCase();

        if (sub === 'add') {
            const text = args.slice(2).join(' ').trim();
            if (!text) {
                await waSock.sendMessage(from, { text: "❓ Usage: .note add <text>" }, { quoted: msg });
                return true;
            }
            const note = addNote(from, text);
            await waSock.sendMessage(from, { text: `✅ Note saved (ID: ${note.id})` }, { quoted: msg });
        } else if (sub === 'list') {
            const notes = listNotes(from);
            if (notes.length === 0) {
                await waSock.sendMessage(from, { text: "📝 Belum ada catatan." }, { quoted: msg });
            } else {
                const lines = notes.map((n, i) => `${i + 1}. [${n.id}] ${n.text}`);
                await waSock.sendMessage(from, { text: `📝 *Notes*\n\n${lines.join('\n')}` }, { quoted: msg });
            }
        } else if (sub === 'search') {
            const query = args.slice(2).join(' ').trim();
            if (!query) {
                await waSock.sendMessage(from, { text: "❓ Usage: .note search <query>" }, { quoted: msg });
                return true;
            }
            const notes = searchNotes(from, query);
            if (notes.length === 0) {
                await waSock.sendMessage(from, { text: `🔍 Tidak ada catatan cocok "${query}".` }, { quoted: msg });
            } else {
                const lines = notes.map((n, i) => `${i + 1}. [${n.id}] ${n.text}`);
                await waSock.sendMessage(from, { text: `🔍 *Search: ${query}*\n\n${lines.join('\n')}` }, { quoted: msg });
            }
        } else if (sub === 'delete') {
            const noteId = args[2];
            if (!noteId) {
                await waSock.sendMessage(from, { text: "❓ Usage: .note delete <id>" }, { quoted: msg });
                return true;
            }
            const ok = deleteNote(from, noteId);
            await waSock.sendMessage(from, { text: ok ? `🗑️ Note ${noteId} deleted.` : `❌ Note ${noteId} not found.` }, { quoted: msg });
        } else {
            // Show note commands with buttons
            await sendButtons(waSock, from, '📝 *Note Commands*', [
                { id: '.note list', text: '📋 List Notes' },
                { id: '.note add ', text: '➕ Add Note' },
                { id: '.note search ', text: '🔍 Search' }
            ], { footer: 'Atau ketik .note <command>' });
        }
        return true;
    }

    // Reminder Commands
    if (lowerText.startsWith('.reminder')) {
        const args = textMessage.trim().split(/\s+/);
        const sub = args[1]?.toLowerCase();

        if (sub === 'list') {
            const reminders = listReminders(from);
            if (reminders.length === 0) {
                await waSock.sendMessage(from, { text: "⏰ Belum ada reminder aktif." }, { quoted: msg });
            } else {
                const lines = reminders.map(r => `[${r.id}] ${r.time} - ${r.text}`);
                await waSock.sendMessage(from, { text: `⏰ *Active Reminders*\n\n${lines.join('\n')}` }, { quoted: msg });
            }
        } else if (sub === 'cancel') {
            const id = args[2];
            if (!id) {
                await waSock.sendMessage(from, { text: "❓ Usage: .reminder cancel <id>" }, { quoted: msg });
                return true;
            }
            const ok = cancelReminder(from, id);
            await waSock.sendMessage(from, { text: ok ? `🗑️ Reminder ${id} cancelled.` : `❌ Reminder ${id} not found.` }, { quoted: msg });
        } else {
            // Set reminder: .reminder <HH:MM> <text>
            const timeStr = sub;
            const text = args.slice(2).join(' ').trim();
            if (!timeStr || !text) {
                await waSock.sendMessage(from, { text: "❓ Usage: .reminder <HH:MM> <text>" }, { quoted: msg });
                return true;
            }
            if (!/^\d{2}:\d{2}$/.test(timeStr)) {
                await waSock.sendMessage(from, { text: "❌ Format waktu harus HH:MM (contoh: 14:30)" }, { quoted: msg });
                return true;
            }
            const reminder = setReminder(from, timeStr, text);
            await waSock.sendMessage(from, { text: `⏰ Reminder set: ${timeStr}\n\n${text}\n\n(ID: ${reminder.id})` }, { quoted: msg });
        }
        return true;
    }

    // Music Player
    const playMatch = textMessage.trim().match(/^\.play\s+(.+)$/i);
    if (playMatch) {
        const input = playMatch[1].trim();

        // Send searching message (will be edited later)
        const searchMsg = await waSock.sendMessage(from, { text: `🔍 Searching: ${input}...` });

        // Check if input is a URL
        const isUrl = input.startsWith('http://') || input.startsWith('https://');
        const result = isUrl
            ? await downloadByTrackUrl(input)
            : await downloadSong(input);

        if (!result.ok) {
            await waSock.sendMessage(from, { text: `❌ ${result.error}` }, { quoted: msg });
            return true;
        }

        try {
            // Edit message to show playing status with externalAdReply
            if (result.image) {
                const thumbnail = await fetchBuffer(result.image);
                await waSock.sendMessage(from, {
                    text: `🎵 Now Playing`,
                    edit: searchMsg.key,
                    externalAdReply: {
                        title: result.title || 'Unknown',
                        body: `${result.artist || 'Unknown'}${result.album ? ` • ${result.album}` : ''}${result.duration ? ` • ${result.duration}` : ''}`,
                        thumbnail: thumbnail || undefined,
                        largeThumbnail: true,
                        sourceUrl: 'https://open.spotify.com'
                    }
                });
            } else {
                await waSock.sendMessage(from, {
                    text: `🎵 *${result.title}*\n👤 ${result.artist}${result.album ? `\n💿 ${result.album}` : ''}${result.duration ? `\n⏱️ ${result.duration}` : ''}`,
                    edit: searchMsg.key
                });
            }

            // Send audio
            if (result.downloadUrl) {
                const audioRes = await fetch(result.downloadUrl);
                const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

                await waSock.sendMessage(from, {
                    audio: audioBuffer,
                    mimetype: 'audio/mpeg',
                    ptt: false
                }, { quoted: msg });
            }
        } catch (e) {
            await waSock.sendMessage(from, { text: `❌ Gagal play: ${e.message}` }, { quoted: msg });
        }

        return true;
    }

    // Spotify Search
    const searchMatch = textMessage.trim().match(/^\.spotify\s+(.+)$/i);
    if (searchMatch) {
        const query = searchMatch[1].trim();

        // Send searching message (will be edited)
        const searchMsg = await waSock.sendMessage(from, { text: `🔍 Searching: ${query}...` });

        const result = await searchSongs(query, 5);

        if (!result.ok) {
            await waSock.sendMessage(from, { text: `❌ ${result.error}` }, { quoted: msg });
            return true;
        }

        const songs = Array.isArray(result.results) ? result.results : [];
        if (songs.length === 0) {
            await waSock.sendMessage(from, { text: "🔍 Tidak ada hasil ditemukan." }, { quoted: msg });
            return true;
        }

        // Cache results and get IDs
        const cacheIds = cacheSearchResults(songs);

        // Edit message to show first result with externalAdReply
        const first = songs[0];
        if (first.cover) {
            const thumbnail = await fetchBuffer(first.cover);
            await waSock.sendMessage(from, {
                text: `🎵 Found ${songs.length} results`,
                edit: searchMsg.key,
                externalAdReply: {
                    title: first.title || 'Unknown',
                    body: `${first.artists || 'Unknown'}${first.duration ? ` • ${first.duration}` : ''}\nTap ▶ Play untuk putar`,
                    thumbnail: thumbnail || undefined,
                    largeThumbnail: true,
                    sourceUrl: first.spotify_search_url || 'https://open.spotify.com'
                }
            });
        } else {
            await waSock.sendMessage(from, {
                text: `🎵 *${first.title || 'Unknown'}*\n👤 ${first.artists || 'Unknown'}${first.duration ? `\n⏱️ ${first.duration}` : ''}\n\nTap ▶ Play untuk putar`,
                edit: searchMsg.key
            });
        }

        // Send track list with cached play buttons
        const trackList = songs.map((s, i) => {
            return `${i + 1}. ${s.title || 'Unknown'} — ${s.artists || 'Unknown'} (${s.duration || ''})`;
        }).join('\n');

        await sendButtons(waSock, from, `🎵 *Search Results*\n\n${trackList}`, songs.slice(0, 4).map((s, i) => ({
            text: `▶ ${s.title?.slice(0, 15) || 'Play'}`,
            id: `playtrack:${cacheIds[i]}`
        })), { footer: '✨ OpenXX Music' });

        return true;
    }

    // Handle track play from button
    const trackPlayMatch = textMessage.trim().match(/^playtrack:(.+)$/i);
    if (trackPlayMatch) {
        const trackId = trackPlayMatch[1].trim();
        const track = getCachedTrack(trackId);

        if (!track) {
            await waSock.sendMessage(from, { text: "⚠️ Track expired. Cari ulang dengan .spotify" }, { quoted: msg });
            return true;
        }

        // Send searching message
        const searchMsg = await waSock.sendMessage(from, { text: `🎵 Playing: ${track.title || track.name}...` });

        try {
            // Use preview_url directly
            if (track.preview_url) {
                const audioRes = await fetch(track.preview_url);
                const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

                // Edit to show now playing with externalAdReply
                if (track.cover) {
                    const thumbnail = await fetchBuffer(track.cover);
                    await waSock.sendMessage(from, {
                        text: '🎵 Now Playing',
                        edit: searchMsg.key,
                        externalAdReply: {
                            title: track.title || track.name || 'Unknown',
                            body: `${track.artists || 'Unknown'}${track.duration ? ` • ${track.duration}` : ''}`,
                            thumbnail: thumbnail || undefined,
                            largeThumbnail: true,
                            sourceUrl: 'https://open.spotify.com'
                        }
                    });
                } else {
                    await waSock.sendMessage(from, {
                        text: `🎵 *${track.title || track.name}*\n👤 ${track.artists || 'Unknown'}`,
                        edit: searchMsg.key
                    });
                }

                // Send audio
                await waSock.sendMessage(from, {
                    audio: audioBuffer,
                    mimetype: 'audio/mpeg',
                    ptt: false
                }, { quoted: msg });
            } else {
                // Fallback: search and download
                const dlResult = await downloadSong(track.title || track.name);
                if (dlResult.ok && dlResult.downloadUrl) {
                    const audioRes = await fetch(dlResult.downloadUrl);
                    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
                    await waSock.sendMessage(from, {
                        text: `🎵 *${track.title || track.name}*`,
                        edit: searchMsg.key
                    });
                    await waSock.sendMessage(from, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                }
            }
        } catch (e) {
            await waSock.sendMessage(from, { text: `❌ Gagal play: ${e.message}` }, { quoted: msg });
        }

        return true;
    }

    // Album Command
    const albumMatch = textMessage.trim().match(/^\.album\s+(.+)$/i);
    if (albumMatch) {
        const query = albumMatch[1].trim();
        await waSock.sendMessage(from, { text: `💿 Searching album: ${query}...` }, { quoted: msg });

        const result = await searchSongs(query, 10);

        if (!result.ok) {
            await waSock.sendMessage(from, { text: `❌ ${result.error}` }, { quoted: msg });
            return true;
        }

        const songs = Array.isArray(result.results) ? result.results : [];
        if (songs.length === 0) {
            await waSock.sendMessage(from, { text: "💿 Album tidak ditemukan." }, { quoted: msg });
            return true;
        }

        // Group by album
        const albumMap = new Map();
        for (const song of songs) {
            const album = song.album || 'Unknown Album';
            if (!albumMap.has(album)) {
                albumMap.set(album, { cover: song.cover, tracks: [] });
            }
            albumMap.get(album).tracks.push(song);
        }

        // Send first album as album message
        const [albumName, albumData] = albumMap.entries().next().value;

        // Cache tracks
        const cacheIds = cacheSearchResults(albumData.tracks);

        // Build album message with cover
        const trackList = albumData.tracks.map((t, i) => `${i + 1}. ${t.title || t.name} — ${t.artists || 'Unknown'} (${t.duration || ''})`).join('\n');

        if (albumData.cover) {
            // Send as album: cover image + track list
            await waSock.sendMessage(from, {
                album: [
                    {
                        image: { url: albumData.cover },
                        caption: `💿 *${albumName}*\n👤 ${albumData.tracks[0]?.artists || 'Unknown'}\n🎵 ${albumData.tracks.length} tracks\n\n${trackList}`,
                    },
                    // Second image: all tracks as cards
                    ...albumData.tracks.slice(0, 5).map((t, i) => ({
                        image: { url: t.cover || albumData.cover },
                        caption: `${i + 1}. ${t.title || t.name}\n⏱️ ${t.duration || ''}\nID: ${cacheIds[i]}`
                    }))
                ]
            }, { quoted: msg });
        } else {
            // No cover: send as text
            await waSock.sendMessage(from, {
                text: `💿 *${albumName}*\n👤 ${albumData.tracks[0]?.artists || 'Unknown'}\n🎵 ${albumData.tracks.length} tracks\n\n${trackList}\n\nKetik \`.play <judul>\nuntuk putar.`,
                footer: '✨ OpenXX Music'
            }, { quoted: msg });
        }

        // If multiple albums, send info
        if (albumMap.size > 1) {
            const otherAlbums = [...albumMap.keys()].slice(1).join(', ');
            await waSock.sendMessage(from, {
                text: `💡 Album lain ditemukan: ${otherAlbums}\nKetik \`.album <nama album>\nuntuk lihat spesifik.`,
                footer: '✨ OpenXX'
            }, { quoted: msg });
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
        } else if (sub === 'train') {
            // Train group - fetch info and save
            await waSock.sendMessage(from, { text: "🔄 Training group..." }, { quoted: msg });
            const result = await trainGroup(waSock, from);
            if (result.ok) {
                const d = result.data;
                const info = [
                    `✅ *Group Trained!*`,
                    `📝 Name: ${d.name}`,
                    `👥 Members: ${d.memberCount}`,
                    d.description ? `📄 Description: ${d.description.slice(0, 100)}` : '',
                    d.members?.length > 0 ? `\n*Members:*\n${d.members.slice(0, 10).map(m => `• ${m.name}${m.isAdmin ? ' (admin)' : ''}`).join('\n')}` : ''
                ].filter(Boolean).join('\n');
                await waSock.sendMessage(from, { text: info }, { quoted: msg });
            } else {
                await waSock.sendMessage(from, { text: `❌ Training failed: ${result.error}` }, { quoted: msg });
            }
        } else if (sub === 'rule') {
            const action = args[2]?.toLowerCase();
            const ruleText = args.slice(3).join(' ').trim();
            
            if (action === 'add' && ruleText) {
                addGroupRule(from, ruleText);
                await waSock.sendMessage(from, { text: `✅ Rule added: ${ruleText}` }, { quoted: msg });
            } else if (action === 'remove' && args[3]) {
                const ok = removeGroupRule(from, args[3]);
                await waSock.sendMessage(from, { text: ok ? `✅ Rule removed` : `❌ Rule not found` }, { quoted: msg });
            } else if (action === 'list') {
                const data = getGroupTraining(from);
                const rules = data?.rules || [];
                if (rules.length === 0) {
                    await waSock.sendMessage(from, { text: "📋 Belum ada rules." }, { quoted: msg });
                } else {
                    const list = rules.map((r, i) => `${i + 1}. [${r.id}] ${r.text}`).join('\n');
                    await waSock.sendMessage(from, { text: `📋 *Rules:*\n\n${list}` }, { quoted: msg });
                }
            } else {
                await waSock.sendMessage(from, { text: "❓ Usage: .group rule add/remove/list <rule text>" }, { quoted: msg });
            }
        } else if (sub === 'topic') {
            const action = args[2]?.toLowerCase();
            const topic = args.slice(3).join(' ').trim();
            
            if (action === 'add' && topic) {
                addGroupTopic(from, topic);
                await waSock.sendMessage(from, { text: `✅ Topic added: ${topic}` }, { quoted: msg });
            } else if (action === 'list') {
                const data = getGroupTraining(from);
                const topics = data?.topics || [];
                if (topics.length === 0) {
                    await waSock.sendMessage(from, { text: "📋 Belum ada topics." }, { quoted: msg });
                } else {
                    await waSock.sendMessage(from, { text: `📋 *Topics:*\n${topics.join(', ')}` }, { quoted: msg });
                }
            } else {
                await waSock.sendMessage(from, { text: "❓ Usage: .group topic add/list <topic>" }, { quoted: msg });
            }
        } else if (sub === 'info') {
            const data = getGroupTraining(from);
            if (!data) {
                await waSock.sendMessage(from, { text: "⚠️ Group belum di-train. Ketik `.group train` dulu." }, { quoted: msg });
            } else {
                const context = getGroupContext(from);
                await waSock.sendMessage(from, { text: `📋 *Group Info:*\n\n${context}` }, { quoted: msg });
            }
        } else {
            await waSock.sendMessage(from, { text: "❓ *Group Commands:*\n.group settings\n.group welcome on/off/<msg>\n.group spam on/off\n.group reply on/off\n.group mute/unmute\n.group ai on/off\n.group approve — AI auto-respond\n.group unapprove — disable AI\n.group delay <sec> — set response delay\n.group keyword add/remove/list\n.group train — train group info\n.group rule add/remove/list\n.group topic add/list\n.group info — view group context" }, { quoted: msg });
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
