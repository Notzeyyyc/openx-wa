import path from 'path';
import { loadJsonConfig, writeJsonConfig } from '../config.js';
import { DATA_DIR } from '../paths.js';

const SCORES_FILE = path.join(DATA_DIR, 'quiz-scores.json');
const SESSION_TTL_MS = 30 * 60 * 1000;

const sessions = new Map(); // chatId -> { questions, idx, score, lastAt }

/**
 * Parse the AI's quiz JSON. Tolerates code fences and answer as letter/index.
 * Returns an array of { q, options, answer } or null.
 */
export function parseQuizResponse(text) {
    if (!text) return null;
    let s = String(text).trim().replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim();
    const start = s.indexOf('[');
    const end = s.lastIndexOf(']');
    if (start === -1 || end <= start) return null;

    let arr;
    try { arr = JSON.parse(s.slice(start, end + 1)); } catch { return null; }
    if (!Array.isArray(arr)) return null;

    const questions = [];
    for (const item of arr) {
        const q = String(item?.q ?? item?.question ?? '').trim();
        const options = Array.isArray(item?.options) ? item.options.map(o => String(o).trim()).filter(Boolean) : [];
        if (!q || options.length < 2) continue;

        let answer = item?.answer;
        if (typeof answer === 'string') {
            const t = answer.trim();
            answer = /^[a-z]$/i.test(t) ? t.toUpperCase().charCodeAt(0) - 65 : parseInt(t, 10) - 1;
        }
        if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) continue;

        questions.push({ q, options, answer });
    }
    return questions.length ? questions : null;
}

/** "A".."D" or "1".."4" -> 0-based index, or -1. */
export function parseAnswer(input, optionCount = 4) {
    const t = String(input || '').trim();
    let idx = -1;
    if (/^[a-z]$/i.test(t)) idx = t.toUpperCase().charCodeAt(0) - 65;
    else if (/^\d+$/.test(t)) idx = parseInt(t, 10) - 1;
    return idx >= 0 && idx < optionCount ? idx : -1;
}

export function gradeAnswer(question, index) {
    return question.answer === index;
}

function isExpired(session) {
    return !session || Date.now() - session.lastAt > SESSION_TTL_MS;
}

export function startQuiz(chatId, questions) {
    sessions.set(chatId, { questions, idx: 0, score: 0, lastAt: Date.now() });
}

export function getSession(chatId) {
    const s = sessions.get(chatId);
    if (isExpired(s)) { sessions.delete(chatId); return null; }
    return s;
}

export function clearSession(chatId) { sessions.delete(chatId); }

export function currentQuestion(chatId) {
    const s = getSession(chatId);
    return s ? s.questions[s.idx] || null : null;
}

export function submitAnswer(chatId, index) {
    const s = getSession(chatId);
    if (!s) return { ok: false, reason: 'no_session' };

    s.lastAt = Date.now();
    const q = s.questions[s.idx];
    const correct = gradeAnswer(q, index);
    if (correct) s.score++;
    s.idx++;

    const done = s.idx >= s.questions.length;
    const result = { ok: true, correct, correctIndex: q.answer, done, score: s.score, total: s.questions.length };
    if (done) sessions.delete(chatId);
    return result;
}

export function recordScore(chatId, score, total) {
    const all = loadJsonConfig(SCORES_FILE, {});
    const prev = all[chatId] || {};
    all[chatId] = {
        best: Math.max(prev.best || 0, score),
        last: score,
        total,
        plays: (prev.plays || 0) + 1,
        updatedAt: Date.now()
    };
    writeJsonConfig(SCORES_FILE, all);
    return all[chatId];
}

export function getScore(chatId) {
    return loadJsonConfig(SCORES_FILE, {})[chatId] || null;
}
