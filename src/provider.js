import { config } from './config.js';

const REQUEST_TIMEOUT_MS = 55000;

// OpenCode inference gateway: chat mounts at /inference/openai, models at /inference
const MODELS_BASE_OVERRIDES = [
    [/^https:\/\/opencode\.ai\/inference\/openai$/, 'https://opencode.ai/inference'],
];

// AgentRouter only accepts requests that look like an approved coding agent
// (Roo Code / Codex / Claude Code). We spoof one client identity and fall back
// to a second if the first is rejected. Scoped to agentrouter.org only, so
// other OpenAI-compatible providers are untouched.
export const CLIENT_HEADER_SETS = [
    {
        name: 'codex',
        headers: {
            Originator: 'codex_cli_rs',
            'User-Agent': 'codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464',
            Version: '0.101.0',
        },
    },
    {
        name: 'roo',
        headers: {
            'X-Stainless-OS': 'Linux',
            'X-Stainless-Arch': process.arch === 'arm64' ? 'arm64' : 'x64',
            'X-Stainless-Lang': 'js',
            'X-Stainless-Runtime': 'node',
            'X-Stainless-Runtime-Version': process.version,
            'HTTP-Referer': 'https://github.com/RooVetGit/Roo-Cline',
            'X-Title': 'Roo Code',
            'User-Agent': 'RooCode/3.53.0',
        },
    },
];

export function isAgentRouter(baseUrl) {
    try {
        const host = new URL(baseUrl).hostname.toLowerCase();
        return host === 'agentrouter.org' || host.endsWith('.agentrouter.org');
    } catch {
        return /(^|\/\/)([a-z0-9-]+\.)*agentrouter\.org/i.test(baseUrl || '');
    }
}

// Order identity sets, starting with the one that last worked (if known).
export function agentRouterHeaderOrder(knownName = null) {
    const known = CLIENT_HEADER_SETS.find(s => s.name === knownName);
    if (!known) return CLIENT_HEADER_SETS;
    return [known, ...CLIENT_HEADER_SETS.filter(s => s !== known)];
}

let knownGoodHeaderSet = null;

/**
 * Build a /v1/chat/completions URL from any base URL.
 * Handles host root (https://host), host+/v1 (https://host/v1),
 * and openrouter-style (https://host/api/v1).
 */
export function buildChatUrl(baseUrl) {
    return `${baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/chat/completions`;
}

/**
 * Build a /v1/models URL from any base URL (same normalization).
 * Applies provider-specific overrides where models live at a different prefix.
 */
export function buildModelsUrl(baseUrl) {
    let base = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
    for (const [re, repl] of MODELS_BASE_OVERRIDES) base = base.replace(re, repl);
    return `${base}/v1/models`;
}

/**
 * Single OpenAI-compatible chat provider.
 * profile: { baseUrl, apiKey, model } — point baseUrl at any
 * /v1/chat/completions-compatible API (Zen, OpenRouter, SumoPod, etc).
 */
export async function chatCompletion(profile, messages, isComplex = false) {
    const baseUrl = profile?.baseUrl || config.ai.openai.baseUrl;
    const apiKey = profile?.apiKey || config.ai.openai.apiKey;
    const model = profile?.model || config.ai.openai.model;
    if (!baseUrl) throw new Error("AI base URL not configured (set OPENX_OPENAI_BASE_URL or use .ai url)");

    const url = buildChatUrl(baseUrl);
    const payload = JSON.stringify({
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: isComplex ? 0.7 : 0.5,
    });
    const apiHeaders = {
        "Content-Type": "application/json",
        ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
    };

    const sets = isAgentRouter(baseUrl) ? agentRouterHeaderOrder(knownGoodHeaderSet) : [null];
    let lastErr;
    for (const set of sets) {
        const response = await fetch(url, {
            method: "POST",
            headers: { ...apiHeaders, ...(set?.headers || {}) },
            body: payload,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (response.ok) {
            if (set) knownGoodHeaderSet = set.name;
            const data = await response.json();
            return data.choices?.[0]?.message?.content || "";
        }

        const errBody = await response.text().catch(() => "");
        lastErr = new Error(`AI API error: ${response.status} ${response.statusText} - ${errBody.slice(0, 200)}`);
        lastErr.status = response.status;

        // Only the client-restriction 401 is worth retrying with another identity.
        if (!(response.status === 401 && errBody.includes('unauthorized_client_error'))) break;
    }
    throw lastErr;
}
