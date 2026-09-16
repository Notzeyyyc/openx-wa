import { loadJsonConfig, writeJsonConfig } from './config.js';
import { config } from './config.js';
import { DATA_DIR } from './paths.js';
import path from 'path';

const CONFIG_PATH = path.join(DATA_DIR, 'ai-config.json');

const DEFAULT_CONFIG = {
    active: 'default',
    profiles: {
        default: { baseUrl: config.ai.openai.baseUrl, apiKey: config.ai.openai.apiKey, model: config.ai.openai.model },
        openrouter: { baseUrl: 'https://openrouter.ai/api', apiKey: '', model: 'deepseek/deepseek-chat' },
    },
};

function getConfig() {
    const cfg = loadJsonConfig(CONFIG_PATH, DEFAULT_CONFIG);
    // Migrate old configs: profiles keyed by provider name, drop `provider` field
    for (const p of Object.values(cfg.profiles || {})) delete p.provider;
    return cfg;
}

function saveConfig(cfg) {
    writeJsonConfig(CONFIG_PATH, cfg);
}

export function getActiveProfile() {
    const cfg = getConfig();
    return cfg.profiles[cfg.active] || cfg.profiles.default;
}

export function getActiveProfileName() {
    return getConfig().active || 'default';
}

export function setActiveProfile(name) {
    const cfg = getConfig();
    if (!cfg.profiles[name]) return false;
    cfg.active = name;
    saveConfig(cfg);
    return true;
}

export function saveProfile(name, data = {}) {
    const cfg = getConfig();
    cfg.profiles[name] = { ...getActiveProfile(), ...cfg.profiles[name], ...data };
    saveConfig(cfg);
}

export function deleteProfile(name) {
    if (name === 'default') return false;
    const cfg = getConfig();
    if (!cfg.profiles[name]) return false;
    delete cfg.profiles[name];
    if (cfg.active === name) cfg.active = 'default';
    saveConfig(cfg);
    return true;
}

export function listProfiles() {
    const cfg = getConfig();
    return Object.entries(cfg.profiles).map(([name, conf]) => ({
        name,
        ...conf,
        active: name === cfg.active
    }));
}

export function getAIStatus() {
    const cfg = getConfig();
    const active = cfg.profiles[cfg.active] || {};
    const lines = [`🤖 *AI Configuration*\n`];
    lines.push(`Active: ${cfg.active} (${active.baseUrl}/${active.model || 'default'})`);
    lines.push(`API Key: ${active.apiKey ? '***' + active.apiKey.slice(-4) : '(not set)'}`);
    lines.push('');
    lines.push('*Profiles:*');
    for (const [name, conf] of Object.entries(cfg.profiles)) {
        const marker = name === cfg.active ? '✅' : '  ';
        const keyStatus = conf.apiKey ? '***' + conf.apiKey.slice(-4) : 'no key';
        lines.push(`${marker} ${name}: ${conf.baseUrl} ${conf.model || 'default'} (${keyStatus})`);
    }
    return lines.join('\n');
}

export function getMainModel() {
    return getActiveProfile().model || '';
}

export function setMainModel(model) {
    const cfg = getConfig();
    const active = cfg.profiles[cfg.active];
    if (active) active.model = model;
    saveConfig(cfg);
}

export function setMainApiKey(apiKey) {
    const cfg = getConfig();
    const active = cfg.profiles[cfg.active];
    if (active) active.apiKey = apiKey;
    saveConfig(cfg);
}

export function setMainBaseUrl(baseUrl) {
    const cfg = getConfig();
    const active = cfg.profiles[cfg.active];
    if (active) active.baseUrl = baseUrl;
    saveConfig(cfg);
}
