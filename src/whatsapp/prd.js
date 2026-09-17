import path from 'path';
import { loadJsonConfig, writeJsonConfig } from '../config.js';
import { DATA_DIR } from '../paths.js';

const PRDS_FILE = path.join(DATA_DIR, 'prds.json');
const SESSION_TTL_MS = 30 * 60 * 1000;

const sessions = new Map(); // chatId -> session

export const PRD_HELP =
    "📝 *PRD Wizard*\n" +
    "• .prd new [ide] — mulai bikin PRD\n" +
    "• .prd <jawaban> — jawab pertanyaan\n" +
    "• .prd skip — lewati pertanyaan\n" +
    "• .prd batal — batalkan\n" +
    "• .prd list / .prd show <id>\n" +
    "• .prd export <id> — kirim file .md";

export const PRD_STEPS = [
    { key: 'platform', kind: 'menu', question: 'Platform produk?', options: ['Web', 'Mobile', 'Desktop', 'Web + Mobile'] },
    { key: 'target', kind: 'text', question: 'Siapa target user-nya?' },
    { key: 'problem', kind: 'text', question: 'Masalah inti yang mau dipecahkan?' },
    { key: 'features', kind: 'features', question: 'Fitur MVP — pilih dari rekomendasi AI:' },
    { key: 'metric', kind: 'menu', question: 'Metrik sukses utama?', options: ['Retention', 'Conversion', 'MAU', 'DAU'] }
];

/** "1,3 5" or "A C" -> sorted unique 0-based indices. */
export function parseMenuSelection(input, max) {
    const out = new Set();
    for (const token of String(input || '').split(/[\s,]+/).filter(Boolean)) {
        let idx = -1;
        if (/^\d+$/.test(token)) idx = parseInt(token, 10) - 1;
        else if (/^[a-z]$/i.test(token)) idx = token.toUpperCase().charCodeAt(0) - 65;
        if (idx >= 0 && idx < max) out.add(idx);
    }
    return [...out].sort((a, b) => a - b);
}

/** Parse a JSON array of feature strings from AI output (tolerates code fences). */
export function parseFeatureList(text) {
    if (!text) return [];
    const s = String(text).trim().replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim();
    const a = s.indexOf('[');
    const b = s.lastIndexOf(']');
    if (a === -1 || b <= a) return [];
    try {
        const arr = JSON.parse(s.slice(a, b + 1));
        if (!Array.isArray(arr)) return [];
        return arr.map(x => String(x).trim()).filter(Boolean).slice(0, 6);
    } catch { return []; }
}

function isExpired(s) {
    return !s || Date.now() - s.lastAt > SESSION_TTL_MS;
}

export function getSession(chatId) {
    const s = sessions.get(chatId);
    if (isExpired(s)) { sessions.delete(chatId); return null; }
    return s;
}

export function clearSession(chatId) { sessions.delete(chatId); }

export function nextPrompt(s) {
    if (!s) return null;
    if (s.step === -1) return { kind: 'idea', question: 'Apa ide/nama produknya? (contoh: aplikasi catatan mahasiswa)' };
    if (s.step >= PRD_STEPS.length) return { kind: 'done' };
    const step = PRD_STEPS[s.step];
    return {
        kind: step.kind,
        key: step.key,
        question: step.question,
        options: step.options,
        featureOptions: step.kind === 'features' ? s.featureOptions : undefined
    };
}

export function startPrd(chatId, idea) {
    const s = { idea: idea || null, step: idea ? 0 : -1, answers: {}, featureOptions: [], lastAt: Date.now() };
    sessions.set(chatId, s);
    return nextPrompt(s);
}

export function setFeatureOptions(chatId, options) {
    const s = getSession(chatId);
    if (!s) return;
    s.featureOptions = options || [];
}

export function submitPrdAnswer(chatId, value) {
    const s = getSession(chatId);
    if (!s) return { ok: false, reason: 'no_session' };
    s.lastAt = Date.now();
    const raw = String(value || '').trim() || '(tidak diisi)';

    if (s.step === -1) {
        s.idea = raw;
        s.step = 0;
        return { ok: true, prompt: nextPrompt(s) };
    }

    const step = PRD_STEPS[s.step];
    let answer = raw;
    if (step.kind === 'menu') {
        const [idx] = parseMenuSelection(raw, step.options.length);
        if (idx !== undefined) answer = step.options[idx];
    } else if (step.kind === 'features') {
        const picks = parseMenuSelection(raw, s.featureOptions.length);
        if (picks.length) answer = picks.map(i => s.featureOptions[i]).join(', ');
    }
    s.answers[step.key] = answer;
    s.step++;
    return { ok: true, prompt: nextPrompt(s) };
}

export function skipStep(chatId) {
    const s = getSession(chatId);
    if (!s) return { ok: false, reason: 'no_session' };
    s.lastAt = Date.now();
    if (s.step === -1) {
        s.idea = '(tidak diisi)';
        s.step = 0;
        return { ok: true, prompt: nextPrompt(s) };
    }
    const step = PRD_STEPS[s.step];
    s.answers[step.key] = s.answers[step.key] || '(tidak diisi)';
    s.step++;
    return { ok: true, prompt: nextPrompt(s) };
}

export function formatPrompt(prompt) {
    if (!prompt) return '';
    let text = prompt.question || '';
    if (prompt.options) {
        text += '\n\n' + prompt.options.map((o, i) => `${i + 1}. ${o}`).join('\n') + '\n\nBalas angkanya (atau tulis sendiri).';
    }
    if (prompt.featureOptions?.length) {
        text += '\n\n' + prompt.featureOptions.map((o, i) => `${i + 1}. ${o}`).join('\n') + '\n\nBalas nomornya (boleh banyak: 1,3,5) atau tulis sendiri.';
    }
    return text;
}

export function buildPrdPrompt(s) {
    const a = s.answers || {};
    return [
        'Buat PRD (Product Requirements Document) dalam bahasa Indonesia, format markdown rapi.',
        '',
        `Ide: ${s.idea || '-'}`,
        `Platform: ${a.platform || '-'}`,
        `Target user: ${a.target || '-'}`,
        `Masalah: ${a.problem || '-'}`,
        `Fitur MVP: ${a.features || '-'}`,
        `Metrik sukses: ${a.metric || '-'}`,
        '',
        'Wajib ada seksi: Overview, Problem, Goals, Target User, Scope (MVP), Non-goals, Success Metrics, Milestones, Open Questions.',
        'Jangan mengarang fakta di luar info di atas.'
    ].join('\n');
}

export function savePrd(chatId, { title, content }) {
    const all = loadJsonConfig(PRDS_FILE, {});
    const list = all[chatId] || [];
    const id = Date.now().toString().slice(-6);
    list.push({ id, title: title || 'PRD', content, createdAt: Date.now() });
    all[chatId] = list;
    writeJsonConfig(PRDS_FILE, all);
    return { id, title: title || 'PRD' };
}

export function listPrds(chatId) {
    return loadJsonConfig(PRDS_FILE, {})[chatId] || [];
}

export function getPrd(chatId, id) {
    return listPrds(chatId).find(p => p.id === id) || null;
}
