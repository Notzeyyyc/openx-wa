import { loadJsonConfig, writeJsonConfig } from './config.js';

const CONFIG_PATH = './package/ai-config.json';

const DEFAULT_CONFIG = {
    main: { provider: 'openai', model: '' },
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
}

export function setMainModel(model) {
    const cfg = getAIConfig();
    cfg.main.model = model;
    setAIConfig(cfg);
}

export function setAgentConfig(agentType, provider, model) {
    const cfg = getAIConfig();
    if (!cfg.agents[agentType]) cfg.agents[agentType] = {};
    if (provider) cfg.agents[agentType].provider = provider;
    if (model) cfg.agents[agentType].model = model;
    setAIConfig(cfg);
}

export function getAIStatus() {
    const cfg = getAIConfig();
    const lines = [`🤖 *AI Configuration*\n`];
    lines.push(`Main: ${cfg.main.provider} ${cfg.main.model || '(default)'}`);
    lines.push('');
    lines.push('*Agent Overrides:*');
    for (const [type, conf] of Object.entries(cfg.agents)) {
        if (conf.provider || conf.model) {
            lines.push(`${type}: ${conf.provider || '(inherit)'} ${conf.model || '(default)'}`);
        }
    }
    return lines.join('\n');
}
