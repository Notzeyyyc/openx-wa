import fs from 'fs';
import { loadJsonConfig, writeJsonConfig } from './config.js';

const CONFIG_PATH = './package/ai-config.json';

const DEFAULT_CONFIG = {
    active: 'sumopod', // active profile name
    agentic: false, // agentic mode
    profiles: {
        sumopod: { provider: 'openai', model: 'gpt-4o-mini', apiKey: '', baseUrl: 'https://ai.sumopod.com' },
        openrouter: { provider: 'openrouter', model: '', apiKey: '', baseUrl: '' },
        claude: { provider: 'claude', model: 'anthropic/claude-opus-4.8', apiKey: '', baseUrl: 'https://fgsi.dpdns.org/api/ai/claude' },
        chatgpt: { provider: 'chatgpt', model: 'openai/gpt-4o', apiKey: '', baseUrl: 'https://fgsi.dpdns.org/api/ai/chatgpt' },
        gemini: { provider: 'gemini', model: 'google/gemini-2.5-flash', apiKey: '', baseUrl: 'https://fgsi.dpdns.org/api/ai/gemini' },
    },
    agents: {
        research: { profile: '' },
        code: { profile: '' },
        translate: { profile: '' },
        summary: { profile: '' },
        homework: { profile: '' },
        essay: { profile: '' },
        solver: { profile: '' },
        vision: { profile: '' },
    }
};

function getConfig() {
    return loadJsonConfig(CONFIG_PATH, DEFAULT_CONFIG);
}

export function getAIConfig() {
    return getConfig();
}

function saveConfig(cfg) {
    writeJsonConfig(CONFIG_PATH, cfg);
}

// Get active profile
export function getActiveProfile() {
    const cfg = getConfig();
    return cfg.profiles[cfg.active] || cfg.profiles.sumopod;
}

export function getActiveProfileName() {
    return getConfig().active || 'sumopod';
}

// Get agent profile (fallback to active)
export function getAgentProfile(agentType) {
    const cfg = getConfig();
    const agentConf = cfg.agents[agentType];
    if (agentConf?.profile && cfg.profiles[agentConf.profile]) {
        return cfg.profiles[agentConf.profile];
    }
    return getActiveProfile();
}

// Switch active profile
export function setActiveProfile(name) {
    const cfg = getConfig();
    if (!cfg.profiles[name]) return false;
    cfg.active = name;
    saveConfig(cfg);
    return true;
}

// Save/update profile
export function saveProfile(name, data) {
    const cfg = getConfig();
    cfg.profiles[name] = { ...cfg.profiles[name], ...data };
    saveConfig(cfg);
}

// Delete profile
export function deleteProfile(name) {
    if (name === 'sumopod') return false; // can't delete default
    const cfg = getConfig();
    delete cfg.profiles[name];
    if (cfg.active === name) cfg.active = 'sumopod';
    saveConfig(cfg);
    return true;
}

// List all profiles
export function listProfiles() {
    const cfg = getConfig();
    return Object.entries(cfg.profiles).map(([name, conf]) => ({
        name,
        ...conf,
        active: name === cfg.active
    }));
}

// Set agent profile
export function setAgentProfile(agentType, profileName) {
    const cfg = getConfig();
    if (!cfg.agents[agentType]) cfg.agents[agentType] = {};
    cfg.agents[agentType].profile = profileName || '';
    saveConfig(cfg);
}

// Get AI status
export function getAIStatus() {
    const cfg = getConfig();
    const active = cfg.profiles[cfg.active] || {};
    const lines = [`🤖 *AI Configuration*\n`];
    lines.push(`Active: ${cfg.active} (${active.provider}/${active.model || 'default'})`);
    lines.push(`API Key: ${active.apiKey ? '***' + active.apiKey.slice(-4) : '(not set)'}`);
    lines.push('');
    lines.push('*Profiles:*');
    for (const [name, conf] of Object.entries(cfg.profiles)) {
        const marker = name === cfg.active ? '✅' : '  ';
        const keyStatus = conf.apiKey ? '***' + conf.apiKey.slice(-4) : 'no key';
        lines.push(`${marker} ${name}: ${conf.provider} ${conf.model || 'default'} (${keyStatus})`);
    }
    lines.push('');
    lines.push('*Agent Overrides:*');
    for (const [type, conf] of Object.entries(cfg.agents)) {
        if (conf.profile) {
            lines.push(`  ${type} → ${conf.profile}`);
        }
    }
    return lines.join('\n');
}

// Compatibility exports
export function getMainProvider() {
    return getActiveProfile().provider || 'openai';
}

export function getMainModel() {
    return getActiveProfile().model || '';
}

export function getMainApiKey() {
    return getActiveProfile().apiKey || '';
}

export function getAgentProvider(agentType) {
    return getAgentProfile(agentType).provider || 'openai';
}

export function getAgentModel(agentType) {
    return getAgentProfile(agentType).model || '';
}

export function getAgentApiKey(agentType) {
    return getAgentProfile(agentType).apiKey || '';
}

export function setMainProvider(provider) {
    const cfg = getConfig();
    const active = cfg.profiles[cfg.active];
    if (active) {
        active.provider = provider;
        // Auto-update baseUrl based on provider
        const BASE_URLS = {
            openai: 'https://ai.sumopod.com',
            claude: 'https://fgsi.dpdns.org/api/ai/claude',
            chatgpt: 'https://fgsi.dpdns.org/api/ai/chatgpt',
            gemini: 'https://fgsi.dpdns.org/api/ai/gemini',
            openrouter: '',
            rest: ''
        };
        if (BASE_URLS[provider] !== undefined) {
            active.baseUrl = BASE_URLS[provider];
        }
        // Auto-update model based on provider
        const DEFAULT_MODELS = {
            openai: 'gpt-4o-mini',
            claude: 'anthropic/claude-opus-4.8',
            chatgpt: 'openai/gpt-4o',
            gemini: 'google/gemini-2.5-pro',
            openrouter: '',
            rest: ''
        };
        if (!active.model || Object.values(DEFAULT_MODELS).includes(active.model)) {
            active.model = DEFAULT_MODELS[provider] || '';
        }
    }
    saveConfig(cfg);
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

export function setAgentApiKey(agentType, apiKey) {
    const cfg = getConfig();
    const agentProfile = cfg.agents[agentType]?.profile;
    if (agentProfile && cfg.profiles[agentProfile]) {
        cfg.profiles[agentProfile].apiKey = apiKey;
        saveConfig(cfg);
    }
}

export function setAgentConfig(agentType, profileName) {
    const cfg = getConfig();
    if (!cfg.agents[agentType]) cfg.agents[agentType] = {};
    cfg.agents[agentType].profile = profileName || '';
    saveConfig(cfg);
}

// Agentic mode
export function isAgentic() {
    return getConfig().agentic || false;
}

export function setAgentic(value) {
    const cfg = getConfig();
    cfg.agentic = value;
    saveConfig(cfg);
}

export function toggleAgentic() {
    const cfg = getConfig();
    cfg.agentic = !cfg.agentic;
    saveConfig(cfg);
    return cfg.agentic;
}
