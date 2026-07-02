import fs from 'fs';
import path from 'path';

function loadDotEnvIfPresent() {
    try {
        const filePath = path.resolve(process.cwd(), '.env');
        if (!fs.existsSync(filePath)) return;
        const raw = fs.readFileSync(filePath, 'utf-8');
        for (const line of raw.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const idx = trimmed.indexOf('=');
            if (idx === -1) continue;
            const key = trimmed.slice(0, idx).trim();
            let val = trimmed.slice(idx + 1).trim();
            if (!key) continue;
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            if (process.env[key] === undefined) {
                process.env[key] = val;
            }
        }
    } catch {}
}

loadDotEnvIfPresent();

if ((process.env.OPENX_AI_PROVIDER || 'openrouter') === 'rest' && !process.env.OPENX_REST_API_KEY) {
    console.warn('[CONFIG WARNING] OPENX_REST_API_KEY not set! REST API will fail.');
}

function splitCsv(value) {
    return String(value || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

function parseHeaders(raw) {
    try { return JSON.parse(raw); } catch { return {}; }
}

// Config cache: { data, mtime }
const configCache = new Map();

export function loadJsonConfig(filePath, fallback = {}) {
    const abs = path.resolve(process.cwd(), filePath);
    try {
        const stat = fs.statSync(abs);
        const cached = configCache.get(abs);
        if (cached && cached.mtime === stat.mtimeMs) return cached.data;
        const data = JSON.parse(fs.readFileSync(abs, 'utf-8'));
        configCache.set(abs, { data, mtime: stat.mtimeMs });
        return data;
    } catch {
        return fallback;
    }
}

export function writeJsonConfig(filePath, data) {
    const abs = path.resolve(process.cwd(), filePath);
    fs.writeFileSync(abs, JSON.stringify(data, null, 2));
    configCache.delete(abs);
}

export const config = {
    devPhoneNumber: process.env.OPENX_DEV_PHONE_NUMBER || "",
    ai: {
        provider: process.env.OPENX_AI_PROVIDER || "openrouter",
        openrouter: {
            apiKeys: splitCsv(process.env.OPENX_OPENROUTER_API_KEYS),
        },
        rest: {
            baseUrl: process.env.OPENX_REST_BASE_URL || "https://zelapioffciall.dpdns.org/ai/sdk",
            apiKey: process.env.OPENX_REST_API_KEY || "",
            model: process.env.OPENX_REST_MODEL || "deepseek/deepseek-v4-pro",
            method: process.env.OPENX_REST_METHOD || "GET",
            paramName: process.env.OPENX_REST_PARAM_NAME || "text",
            apikeyParam: process.env.OPENX_REST_APIKEY_PARAM || "apikey",
            answerField: process.env.OPENX_REST_ANSWER_FIELD || "response",
            headers: parseHeaders(process.env.OPENX_REST_HEADERS || "{}"),
        },
        openai: {
            baseUrl: process.env.OPENX_OPENAI_BASE_URL || "https://ai.sumopod.com",
            apiKey: process.env.OPENX_OPENAI_API_KEY || "",
            model: process.env.OPENX_OPENAI_MODEL || "gpt-4o-mini",
        },
        claude: {
            baseUrl: process.env.OPENX_CLAUDE_BASE_URL || "https://fgsi.dpdns.org/api/ai/claude",
            apiKey: process.env.OPENX_CLAUDE_API_KEY || "",
            model: process.env.OPENX_CLAUDE_MODEL || "anthropic/claude-opus-4.8",
            webSearch: (process.env.OPENX_CLAUDE_WEB_SEARCH || "false") === "true",
            deepResearch: (process.env.OPENX_CLAUDE_DEEP_RESEARCH || "false") === "true",
        },
        chatgpt: {
            baseUrl: process.env.OPENX_CHATGPT_BASE_URL || "https://fgsi.dpdns.org/api/ai/chatgpt",
            apiKey: process.env.OPENX_CHATGPT_API_KEY || "",
            model: process.env.OPENX_CHATGPT_MODEL || "openai/gpt-4o",
            webSearch: (process.env.OPENX_CHATGPT_WEB_SEARCH || "false") === "true",
            deepResearch: (process.env.OPENX_CHATGPT_DEEP_RESEARCH || "false") === "true",
        },
        gemini: {
            baseUrl: process.env.OPENX_GEMINI_BASE_URL || "https://fgsi.dpdns.org/api/ai/gemini",
            apiKey: process.env.OPENX_GEMINI_API_KEY || "",
            model: process.env.OPENX_GEMINI_MODEL || "google/gemini-2.5-flash",
            webSearch: (process.env.OPENX_GEMINI_WEB_SEARCH || "false") === "true",
            deepResearch: (process.env.OPENX_GEMINI_DEEP_RESEARCH || "false") === "true",
        },
    },
    openrouter: {
        get apiKeys() { return splitCsv(process.env.OPENX_OPENROUTER_API_KEYS); },
    },

    plugins: {
        npm: splitCsv(process.env.OPENX_PLUGINS_NPM),
        allowUnpinned: (process.env.OPENX_ALLOW_UNPINNED_PLUGINS || "").toLowerCase() === "true",
    }
};
