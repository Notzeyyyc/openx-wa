import fs from 'fs';
import { loadJsonConfig, writeJsonConfig } from './config.js';

const CONFIG_PATH = './package/ai-config.json';

const DEFAULT_CONFIG = {
    main: { provider: 'openai', model: '', apiKey: '' },
    agents: {
        research: { provider: '', model: '' },
        code: { provider: '', model: '' },
        translate: { provider: '', model: '' },
        summary: { provider: '', model: '' },
        homework: { provider: '', model: '' },
        essay: { provider: '', model: '' },
        solver: { provider: '', model: '' },
        vision: { provider: '', model: '' },
    }
};

// Provider -> env var mapping
const PROVIDER_ENV_MAP = {
    openai: { key: 'OPENX_OPENAI_API_KEY', model: 'OPENX_OPENAI_MODEL', base: 'OPENX_OPENAI_BASE_URL' },
    claude: { key: 'OPENX_CLAUDE_API_KEY', model: 'OPENX_CLAUDE_MODEL', base: 'OPENX_CLAUDE_BASE_URL' },
    chatgpt: { key: 'OPENX_CHATGPT_API_KEY', model: 'OPENX_CHATGPT_MODEL', base: 'OPENX_CHATGPT_BASE_URL' },
    gemini: { key: 'OPENX_GEMINI_API_KEY', model: 'OPENX_GEMINI_MODEL', base: 'OPENX_GEMINI_BASE_URL' },
    openrouter: { key: 'OPENX_OPENROUTER_API_KEYS', model: '', base: '' },
};

function updateEnvFile(key, value) {
    const envPath = './.env';
    let env = '';
    try { env = fs.readFileSync(envPath, 'utf-8'); } catch {}
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(env)) {
        env = env.replace(regex, `${key}=${value}`);
    } else {
        env = env.trimEnd() + `\n${key}=${value}\n`;
    }
    fs.writeFileSync(envPath, env);
}

export function getAIConfig() {
    return loadJsonConfig(CONFIG_PATH, DEFAULT_CONFIG);
}

export function setAIConfig(config) {
    writeJsonConfig(CONFIG_PATH, config);
}

export function getMainProvider() {
    const cfg = getAIConfig();
    return cfg.main.provider || process.env.OPENX_AI_PROVIDER || 'openai';
}

export function getMainModel() {
    const cfg = getAIConfig();
    return cfg.main.model || '';
}

export function getMainApiKey() {
    const cfg = getAIConfig();
    const provider = cfg.main.provider || 'openai';
    // Check ai-config first, then env
    if (cfg.main.apiKey) return cfg.main.apiKey;
    const envKey = PROVIDER_ENV_MAP[provider]?.key;
    return envKey ? (process.env[envKey] || '') : '';
}

export function getAgentProvider(agentType) {
    const cfg = getAIConfig();
    return cfg.agents[agentType]?.provider || cfg.main.provider || process.env.OPENX_AI_PROVIDER || 'openai';
}

export function getAgentModel(agentType) {
    const cfg = getAIConfig();
    return cfg.agents[agentType]?.model || cfg.main.model || '';
}

export function setMainProvider(provider) {
    const cfg = getAIConfig();
    cfg.main.provider = provider;
    setAIConfig(cfg);
    updateEnvFile('OPENX_AI_PROVIDER', provider);
}

export function setMainModel(model) {
    const cfg = getAIConfig();
    cfg.main.model = model;
    setAIConfig(cfg);
    const provider = cfg.main.provider || 'openai';
    const envKey = PROVIDER_ENV_MAP[provider]?.model;
    if (envKey) updateEnvFile(envKey, model);
}

export function setMainApiKey(apiKey) {
    const cfg = getAIConfig();
    cfg.main.apiKey = apiKey;
    setAIConfig(cfg);
    const provider = cfg.main.provider || 'openai';
    const envKey = PROVIDER_ENV_MAP[provider]?.key;
    if (envKey) updateEnvFile(envKey, apiKey);
}

export function setAgentConfig(agentType, provider, model) {
    const cfg = getAIConfig();
    if (!cfg.agents[agentType]) cfg.agents[agentType] = {};
    if (provider) cfg.agents[agentType].provider = provider;
    if (model) cfg.agents[agentType].model = model;
    setAIConfig(cfg);
}

export function getAgentApiKey(agentType) {
    const cfg = getAIConfig();
    const agentConf = cfg.agents[agentType];
    if (agentConf?.apiKey) return agentConf.apiKey;
    // Fallback to main API key
    return cfg.main.apiKey || '';
}

export function setAgentApiKey(agentType, apiKey) {
    const cfg = getAIConfig();
    if (!cfg.agents[agentType]) cfg.agents[agentType] = {};
    cfg.agents[agentType].apiKey = apiKey;
    setAIConfig(cfg);
}

export function getAIStatus() {
    const cfg = getAIConfig();
    const lines = [`🤖 *AI Configuration*\n`];
    lines.push(`Main: ${cfg.main.provider} ${cfg.main.model || '(default)'}`);
    lines.push(`API Key: ${cfg.main.apiKey ? '***' + cfg.main.apiKey.slice(-4) : '(not set)'}`);
    lines.push('');
    lines.push('*Agent Overrides:*');
    for (const [type, conf] of Object.entries(cfg.agents)) {
        if (conf.provider || conf.model) {
            lines.push(`${type}: ${conf.provider || '(inherit)'} ${conf.model || '(default)'}`);
        }
    }
    return lines.join('\n');
}
