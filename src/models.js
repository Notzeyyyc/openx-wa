import { buildModelsUrl } from './provider.js';

const FAMILIES = [
    [/^claude-/, 'Anthropic'],
    [/^gpt-/, 'OpenAI'],
    [/^gemini-/, 'Google'],
    [/^deepseek-/, 'DeepSeek'],
    [/^glm-/, 'Z.ai'],
    [/^kimi-/, 'Moonshot'],
    [/^minimax-/, 'MiniMax'],
    [/^grok-/, 'xAI'],
    [/^qwen/, 'Alibaba'],
    [/^nemotron-/, 'NVIDIA'],
    [/^muse-/, 'Meta'],
    [/^ling-/, 'Ant Group'],
    [/^mimo-/, 'Xiaomi'],
    [/^big-pickle$/, 'Stealth'],
];

export function modelFamily(id) {
    for (const [re, name] of FAMILIES) {
        if (re.test(id)) return name;
    }
    return 'Other';
}

export function groupByFamily(ids) {
    const groups = {};
    for (const id of ids) {
        const fam = modelFamily(id);
        (groups[fam] ??= []).push(id);
    }
    return groups;
}

export async function listModels(profile) {
    const url = buildModelsUrl(profile.baseUrl);
    const res = await fetch(url, {
        headers: profile.apiKey ? { Authorization: `Bearer ${profile.apiKey}` } : {},
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, ids: (data.data ?? []).map(m => m.id).sort() };
}
