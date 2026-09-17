import path from 'path';
import { loadJsonConfig, writeJsonConfig } from '../config.js';
import { DATA_DIR } from '../paths.js';
import {
    fetchBuffer,
    listLocalFiles, deleteLocalFileById, renameLocalFileById,
    fetchArticleText, stripMarkdown
} from './helpers.js';
import { chatCompletion } from '../provider.js';
import { buildPollPayload } from './poll.js';
import {
    parseQuizResponse, parseAnswer, startQuiz, getSession as getQuizSession,
    currentQuestion, submitAnswer, clearSession as clearQuiz, recordScore
} from './quiz.js';
import {
    openSession as openAbsen, getSession as getAbsenSession,
    markPresent, closeSession as closeAbsen, formatHadir
} from './absen.js';
import { webSearch } from './web-search.js';
import { generateImage } from './image-gen.js';
import { pendingSensitiveActions, executeSensitiveAction } from './sensitive-actions.js';
import { clearHistory } from './conversation-store.js';
import { getRamReport, getRamTrend, forceGarbageCollect } from './ram-monitor.js';
import {
    getMainModel, setMainModel, setMainApiKey, setMainBaseUrl,
    getAIStatus, getActiveProfileName, setActiveProfile, saveProfile,
    listProfiles, deleteProfile, getActiveProfile
} from '../ai-config.js';
import { addNote, listNotes, deleteNote, searchNotes } from './notes.js';
import { setReminder, listReminders, cancelReminder } from './reminders.js';
import { getGroup, setGroup, setGroupApproved, setGroupDelay, isGroupApproved, getGroupKeywords } from './group-manager.js';
import { trainGroup, addGroupRule, removeGroupRule, addGroupTopic, getGroupContext, getGroupTraining } from './group-training.js';
import { listModels, groupByFamily } from '../models.js';
import { getOwner, isOwner, claimOwner } from '../owner.js';

const SENSITIVE_TTL_MS = 2 * 60 * 1000;

// --- tiny helpers shared by all handlers ---
const reply = (ctx, text) => ctx.waSock.sendMessage(ctx.from, { text }, { quoted: ctx.msg });
const replyErr = (ctx, err) => reply(ctx, `❌ ${err}`);

async function sendQuizQuestion(ctx) {
    const q = currentQuestion(ctx.from);
    const s = getQuizSession(ctx.from);
    if (!q || !s) return;
    const opts = q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n');
    await reply(ctx, `Soal ${s.idx + 1}/${s.questions.length}\n\n${q.q}\n\n${opts}\n\nJawab: .jawab <A/B/C/D>`);
}

// --- command handlers (ordered; first regex match wins) ---
const COMMANDS = [
{
    re: /^\.start(?:\s+(\S+))?$/i,
    run: async (ctx, m) => {
        const owner = getOwner();
        if (owner) {
            if (isOwner(ctx.sender)) {
                return reply(ctx, `👑 Kamu owner bot ini (${owner.jid}).\n\nCommand owner udah kebuka: .ai, .group, .model, .note, .reminder, reset, gc`);
            }
            return reply(ctx, "⛔ Bot sudah punya owner.");
        }
        if (!m[1]) {
            return reply(ctx, "🔑 Belum ada owner.\n\nKode setup ada di console/log bot, lalu kirim: `.start <kode>`");
        }
        const res = claimOwner(ctx.sender, ctx.senderName, m[1]);
        if (!res.ok) {
            return reply(ctx, res.reason === 'bad_code' ? "❌ Kode setup salah." : "⛔ Klaim owner gagal.");
        }
        return reply(ctx, `👑 Owner aktif: ${res.owner.jid}\n\nCommand owner sekarang kebuka.`);
    }
},
{
    re: /^\.poll\s+(.+)$/i,
    run: async (ctx, m) => {
        const res = buildPollPayload(m[1]);
        if (!res.ok) {
            const msg = {
                usage: "❓ Usage: .poll <pertanyaan> | opsi 1 | opsi 2",
                name_too_long: "❌ Pertanyaan maks 255 karakter.",
                too_many_options: "❌ Opsi maksimal 12.",
                option_too_long: "❌ Tiap opsi maks 100 karakter."
            };
            return replyErr(ctx, msg[res.error] || "Format poll salah.");
        }
        await ctx.waSock.sendMessage(ctx.from, { poll: res.poll });
    }
},
{
    re: /^\.ringkas\s+(https?:\/\/\S+)$/i,
    run: async (ctx, m) => {
        const { ok, text, error } = await fetchArticleText(m[1]);
        if (!ok) return replyErr(ctx, `Gagal ambil artikel: ${error}`);
        const summary = await chatCompletion(getActiveProfile(), [
            { role: 'system', content: 'Ringkas artikel berikut jadi 3-5 poin bullet singkat berbahasa Indonesia. Jangan menambah fakta baru.' },
            { role: 'user', content: text }
        ]);
        await reply(ctx, stripMarkdown(summary) || "Gagal meringkas artikel.");
    }
},
{
    re: /^\.quiz\s+stop$/i,
    run: async (ctx) => {
        clearQuiz(ctx.from);
        await reply(ctx, "🛑 Quiz dibatalkan.");
    }
},
{
    re: /^\.quiz(?:\s+(.+))?$/i,
    run: async (ctx, m) => {
        const materi = m[1]?.trim() || 'pengetahuan umum';
        await reply(ctx, `🧠 Nyusun 5 soal tentang *${materi}*...`);
        let questions = null;
        try {
            const aiText = await chatCompletion(getActiveProfile(), [
                { role: 'system', content: 'Kamu pembuat soal. Balas HANYA JSON array, tanpa teks lain.' },
                { role: 'user', content: `Buat 5 soal pilihan ganda bahasa Indonesia tentang: ${materi}. Format tepat: [{"q":"pertanyaan","options":["a","b","c","d"],"answer":0}] dengan answer = index jawaban benar (0-3).` }
            ], true);
            questions = parseQuizResponse(aiText);
        } catch (e) {
            return replyErr(ctx, `Gagal bikin soal: ${e.message}`);
        }
        if (!questions) return replyErr(ctx, "AI balas format ngaco, coba lagi.");
        startQuiz(ctx.from, questions.slice(0, 5));
        await sendQuizQuestion(ctx);
    }
},
{
    re: /^\.jawab\s+(\S+)$/i,
    run: async (ctx, m) => {
        const q = currentQuestion(ctx.from);
        if (!q) return replyErr(ctx, "Ga ada quiz aktif. Mulai pakai .quiz");
        const idx = parseAnswer(m[1], q.options.length);
        if (idx < 0) return replyErr(ctx, `Jawaban harus A-${String.fromCharCode(64 + q.options.length)} (atau 1-${q.options.length}).`);

        const res = submitAnswer(ctx.from, idx);
        let msg = res.correct ? "✅ Bener!" : `❌ Salah. Jawaban: ${q.options[res.correctIndex]}`;
        msg += `\nSkor: ${res.score}/${res.total}`;
        await reply(ctx, msg);

        if (res.done) {
            const rec = recordScore(ctx.from, res.score, res.total);
            await reply(ctx, `🏁 Selesai! Skor ${res.score}/${res.total} — terbaik ${rec.best}/${rec.total} (main ${rec.plays}x)`);
        } else {
            await sendQuizQuestion(ctx);
        }
    }
},
{
    re: /^\.absen\s+list$/i,
    run: async (ctx) => {
        if (!ctx.isGroup) return replyErr(ctx, "Absen cuma jalan di grup.");
        await reply(ctx, formatHadir(getAbsenSession(ctx.from)) || "Ga ada sesi absen aktif.");
    }
},
{
    re: /^\.absen\s+tutup$/i,
    admin: true,
    run: async (ctx) => {
        if (!ctx.isGroup) return replyErr(ctx, "Absen cuma jalan di grup.");
        const rec = closeAbsen(ctx.from);
        if (!rec) return replyErr(ctx, "Ga ada sesi absen aktif.");
        const list = rec.hadir.map((h, i) => `${i + 1}. ${h.name}`).join('\n') || '(kosong)';
        await reply(ctx, `✅ Absen ditutup: *${rec.title}*\nHadir (${rec.hadir.length}):\n${list}`);
    }
},
{
    re: /^\.absen(?:\s+(.+))?$/i,
    admin: true,
    run: async (ctx, m) => {
        if (!ctx.isGroup) return replyErr(ctx, "Absen cuma jalan di grup.");
        const title = m[1]?.trim() || 'Absensi';
        openAbsen(ctx.from, title, ctx.senderName);
        await reply(ctx, `📋 Absen dibuka: *${title}*\n\nAnggota ketik *.hadir*. Owner: *.absen tutup*.`);
    }
},
{
    re: /^\.hadir$/i,
    run: async (ctx) => {
        if (!ctx.isGroup) return replyErr(ctx, "Absen cuma jalan di grup.");
        const res = markPresent(ctx.from, ctx.sender, ctx.senderName);
        if (!res.ok) return replyErr(ctx, "Ga ada sesi absen aktif.");
        if (res.already) return reply(ctx, "Kamu udah terdaftar hadir.");
        await reply(ctx, `✅ ${ctx.senderName} hadir. Total: ${res.count}`);
    }
},
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
    re: /^\.model\b/i,
    admin: true,
    run: async (ctx) => {
        const sub = ctx.args[1]?.toLowerCase();
        const modelData = loadJsonConfig(path.join(DATA_DIR, "model.json"), { defaultModel: "", availableModels: [] });

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
            writeJsonConfig(path.join(DATA_DIR, "model.json"), modelData);
            await reply(ctx, `✅ AI Model swapped to: *${found}*`);
        } else {
            await reply(ctx, "❓ *Model Commands:*\n.model list\n.model select [NAME]");
        }
    }
},
{
    re: /^(reset|clear|hapus memory|baru)$/i,
    admin: true,
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
    admin: true,
    run: async (ctx) => {
        const before = process.memoryUsage().heapUsed;
        if (!forceGarbageCollect()) return reply(ctx, "⚠️ GC tidak tersedia (jalankan dengan --expose-gc)");
        const freed = ((before - process.memoryUsage().heapUsed) / 1024 / 1024).toFixed(2);
        await reply(ctx, `🗑️ GC selesai. Freed: ${freed} MB`);
    }
},
{
    re: /^\.ai\b/i,
    admin: true,
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

        if (sub === 'models') {
            const filter = ctx.args[2]?.toLowerCase();
            const profile = getActiveProfile();
            const { ok, ids, error } = await listModels(profile);
            if (!ok) return replyErr(ctx, `Gagal fetch models dari ${profile.baseUrl}: ${error}`);
            const groups = groupByFamily(ids);
            const filterFamilies = filter
                ? Object.entries(groups).filter(([fam]) => fam.toLowerCase().includes(filter))
                : Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
            if (filterFamilies.length === 0) return reply(ctx, `🔍 Tidak ada provider/model yang cocok dengan "${filter}".`);
            let msg = `🤖 *Models — ${getActiveProfileName()}*\n`;
            msg += `Endpoint: ${profile.baseUrl}\n\n`;
            for (const [fam, models] of filterFamilies) {
                msg += `*${fam}* (${models.length})\n`;
                for (const id of models) msg += `• ${id}\n`;
                msg += `\n`;
            }
            msg += `Total: ${ids.length} model`;
            if (ids.some(id => id.includes('free'))) msg += ` | 🆓 = gratis (hanya bisa dipakai dari dalam OpenCode app)`;
            return reply(ctx, msg);
        }

        await reply(ctx, "❓ *AI Commands:*\n.ai status — lihat config\n.ai models [filter] — list models per provider\n.ai switch <name> — switch profile\n.ai save <name> — save current as profile\n.ai delete <name> — delete profile\n.ai url <base-url> — set API base URL (OpenAI-compatible)\n.ai model <name> — set model\n.ai apikey <key> — set API key");
    }
},
{
    re: /^\.group\s+nimbrung(?:\s+(on|off))?$/i,
    admin: true,
    run: async (ctx, m) => {
        if (!ctx.isGroup) return replyErr(ctx, "Group commands only work in groups.");
        const val = m[1]?.toLowerCase();
        if (val === 'on') {
            setGroupApproved(ctx.from, true);
            return reply(ctx, "✅ Nimbrung ON — bot balas semua pesan grup (pakai delay).");
        }
        if (val === 'off') {
            setGroupApproved(ctx.from, false);
            return reply(ctx, "❌ Nimbrung OFF — bot cuma balas kalau di-mention/ada keyword.");
        }
        return reply(ctx, `Nimbrung sekarang: ${isGroupApproved(ctx.from) ? '✅ ON' : '❌ OFF'}\nUsage: .group nimbrung on/off`);
    }
},
{
    re: /^\.group\s+approve$/i,
    admin: true,
    run: async (ctx) => {
        if (!ctx.isGroup) return replyErr(ctx, "Group commands only work in groups.");
        setGroupApproved(ctx.from, true);
        await reply(ctx, "✅ AI approved for this group. AI will respond with 10-15s delay per chat.");
    }
},
{
    re: /^\.group\s+unapprove$/i,
    admin: true,
    run: async (ctx) => {
        if (!ctx.isGroup) return replyErr(ctx, "Group commands only work in groups.");
        setGroupApproved(ctx.from, false);
        await reply(ctx, "❌ AI unapproved for this group. Use .openx <message> to chat.");
    }
},
{
    re: /^\.group\s+delay\s+(\d+)$/i,
    admin: true,
    run: async (ctx, m) => {
        if (!ctx.isGroup) return replyErr(ctx, "Group commands only work in groups.");
        const delay = parseInt(m[1]);
        setGroupDelay(ctx.from, delay);
        await reply(ctx, `✅ AI delay set to ${delay} seconds`);
    }
},
{
    re: /^\.note\b/i,
    admin: true,
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

        await reply(ctx, "📝 *Note Commands:*\n\n.note list — Lihat semua catatan\n.note add <text> — Tambah catatan\n.note search <keyword> — Cari catatan");
    }
},
{
    re: /^\.reminder\b/i,
    admin: true,
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
    re: /^\.group\b/i,
    admin: true,
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
                `Nimbrung (balas semua): ${group.ai_approved ? '✅ ON' : '❌ OFF'}`,
                `AI (mention/keyword): ${group.ai_enabled ? '✅ ON' : '❌ OFF'}`,
                `AI Keywords: ${getGroupKeywords(ctx.from).join(', ')}`,
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
            const currentKw = getGroupKeywords(ctx.from);
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

        await reply(ctx, "❓ *Group Commands:*\n.group settings\n.group welcome on/off/<msg>\n.group spam on/off\n.group reply on/off\n.group mute/unmute\n.group nimbrung on/off — balas semua pesan grup\n.group ai on/off — balas saat mention/keyword\n.group approve/unapprove — alias nimbrung\n.group delay <sec> — set response delay\n.group keyword add/remove/list\n.group train — train group info\n.group rule add/remove/list\n.group topic add/list\n.group info — view group context");
    }
},
];

export async function handleCommands(from, textMessage, msg, waSock) {
    const text = textMessage.trim().replace(/\s+/g, ' ').replace(/^\//, '.');
    const sender = String(msg.key?.participant || from).split(':')[0];
    const ctx = {
        from, msg, waSock, text,
        args: text.split(' '),
        isGroup: from.endsWith('@g.us'),
        sender,
        senderName: msg.pushName || sender.split('@')[0],
        isAdmin: isOwner(sender),
    };

    for (const cmd of COMMANDS) {
        const m = cmd.re.exec(text);
        if (m) {
            if (cmd.admin && !ctx.isAdmin) {
                await reply(ctx, "⛔ Khusus owner.");
                return true;
            }
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
