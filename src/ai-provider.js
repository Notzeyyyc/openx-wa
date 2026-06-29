import { config } from "./config.js";

/**
 * AI Provider Abstraction Layer
 *
 * Routes chatCompletion() calls to the configured provider:
 *   - "openrouter" → OpenRouter (multi-model, key rotation, fallback)
 *   - "rest"       → Custom REST API (stateless or session-based)
 *
 * Usage:
 *   import { chatCompletion } from './package/openx/ai-provider.js';
 *   const reply = await chatCompletion(messages, model, isComplex, userJid);
 */

let _provider = null;

async function getProvider() {
    if (_provider) return _provider;

    const providerName = config.ai?.provider || "openrouter";

    switch (providerName) {
        case "rest": {
            const { chatCompletion } = await import("./providers/rest.js");
            _provider = { complete: chatCompletion, name: "rest" };
            break;
        }
        case "openai": {
            const { chatCompletion } = await import("./providers/openai.js");
            _provider = { complete: chatCompletion, name: "openai" };
            break;
        }
        case "openrouter":
        default: {
            const { chatCompletion } = await import("./providers/openrouter.js");
            _provider = { complete: chatCompletion, name: "openrouter" };
            break;
        }
    }

    console.log(`[AI Provider] Using: ${_provider.name}`);
    return _provider;
}

/**
 * Send messages to the configured AI provider and return the completion.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {string|null} model - model override
 * @param {boolean} isComplex - complex mode flag (OpenRouter only)
 * @param {string|null} userJid - user JID for session tracking (REST only)
 * @returns {Promise<string>}
 */
export async function chatCompletion(messages, model = null, isComplex = false, userJid = null) {
    const provider = await getProvider();
    // REST provider accepts userJid as 4th arg, OpenRouter ignores it
    return provider.complete(messages, model, isComplex, userJid);
}
