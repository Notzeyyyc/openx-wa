import { config } from "./config.js";
import { getMainApiKey, isAgentic } from "./ai-config.js";

// Provider cache: name -> { complete, name }
const providerCache = new Map();

async function loadProvider(name) {
    if (providerCache.has(name)) return providerCache.get(name);

    let provider;
    switch (name) {
        case "rest": {
            const { chatCompletion } = await import("./providers/rest.js");
            provider = { complete: chatCompletion, name: "rest" };
            break;
        }
        case "openai": {
            const { chatCompletion } = await import("./providers/openai.js");
            provider = { complete: chatCompletion, name: "openai" };
            break;
        }
        case "claude": {
            const { chatCompletion } = await import("./providers/claude.js");
            provider = { complete: chatCompletion, name: "claude" };
            break;
        }
        case "chatgpt": {
            const { chatCompletion } = await import("./providers/chatgpt.js");
            provider = { complete: chatCompletion, name: "chatgpt" };
            break;
        }
        case "gemini": {
            const { chatCompletion } = await import("./providers/gemini.js");
            provider = { complete: chatCompletion, name: "gemini" };
            break;
        }
        case "openrouter":
        default: {
            const { chatCompletion } = await import("./providers/openrouter.js");
            provider = { complete: chatCompletion, name: "openrouter" };
            break;
        }
    }

    providerCache.set(name, provider);
    return provider;
}

/**
 * Send messages to AI provider.
 */
export async function chatCompletion(messages, model = null, isComplex = false, userJid = null, providerOverride = null, apiKeyOverride = null) {
    const providerName = providerOverride || config.ai?.provider || "openrouter";

    // Inject API key
    const apiKey = apiKeyOverride || getMainApiKey();
    if (apiKey && config.ai?.[providerName]) {
        config.ai[providerName].apiKey = apiKey;
    }

    // Check if agentic mode is enabled
    const agentic = isAgentic();

    const provider = await loadProvider(providerName);
    return provider.complete(messages, model, isComplex || agentic, userJid);
}
