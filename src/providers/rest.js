import { config } from "../config.js";

const REQUEST_TIMEOUT_MS = 55000;

// Session store: userJid → { chatId, timestamp }
const sessions = new Map();
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * REST API provider — supports any custom REST endpoint.
 *
 * Config (via config.ai.rest):
 *   baseUrl     — endpoint URL (e.g. "https://zelapioffciall.dpdns.org/ai/sdk")
 *   apiKey      — API key for authentication
 *   model       — default AI model (e.g. "deepseek/deepseek-v4-pro")
 *   method      — "GET" or "POST"
 *   paramName   — query/body param name for the prompt (default: "text")
 *   apiKeyParam — query/body param name for the API key (default: "apikey")
 *   answerField — dot-notation path to extract the answer (default: "response")
 */
export async function chatCompletion(messages, modelOverride = null, _isComplex = false, userJid = null) {
    const rest = config.ai?.rest;
    if (!rest?.baseUrl) throw new Error("REST API base URL not configured (set OPENX_REST_BASE_URL)");

    const prompt = flattenMessages(messages);

    const url = new URL(rest.baseUrl);
    const method = (rest.method || "GET").toUpperCase();
    const paramName = rest.paramName || "text";
    const apiKeyParam = rest.apikeyParam || "apikey";
    const answerField = rest.answerField || "response";

    // Model selection: override > config > default
    const model = modelOverride || rest.model || "deepseek/deepseek-v4-pro";

    // Session management: get existing chat_id for this user
    let chatId = null;
    if (userJid) {
        cleanupSessions();
        const session = sessions.get(userJid);
        if (session) chatId = session.chatId;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        let response;

        // Debug: log config values
        console.log(`[REST] Provider config: apiKey=${rest.apiKey ? rest.apiKey.slice(0, 8) + '...' : 'EMPTY'}, method=${method}, paramName=${paramName}, apiKeyParam=${apiKeyParam}`);

        if (method === "GET") {
            url.searchParams.set(paramName, prompt);
            url.searchParams.set("model", model);
            if (rest.apiKey) url.searchParams.set(apiKeyParam, rest.apiKey);
            if (chatId) url.searchParams.set("chat_id", chatId);

            const requestUrl = url.toString();
            console.log(`[REST] GET ${requestUrl.slice(0, 200)}...`);

            response = await fetch(requestUrl, {
                method: "GET",
                headers: rest.headers || {},
                signal: controller.signal,
            });
        } else {
            const body = {};
            body[paramName] = prompt;
            body["model"] = model;
            if (rest.apiKey) body[apiKeyParam] = rest.apiKey;
            if (chatId) body["chat_id"] = chatId;

            console.log(`[REST] POST ${rest.baseUrl} body=${JSON.stringify(body).slice(0, 200)}...`);

            response = await fetch(url.toString(), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(rest.headers || {}),
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
        }

        console.log(`[REST] Response: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'Unable to read body');
            console.log(`[REST] Error body: ${errorBody.slice(0, 500)}`);
            const err = new Error(`REST API error: ${response.status} ${response.statusText} - ${errorBody.slice(0, 200)}`);
            err.status = response.status;
            throw err;
        }

        const data = await response.json();
        console.log(`[REST] Success: response length=${JSON.stringify(data).length}, chat_id=${data.chat_id || 'none'}`);

        // Save session chat_id for multi-turn conversations
        if (userJid && data.chat_id) {
            sessions.set(userJid, {
                chatId: data.chat_id,
                timestamp: Date.now(),
            });
        }

        return extractAnswer(data, answerField);
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Flatten chat messages into a single prompt string.
 */
function flattenMessages(messages) {
    const systemParts = [];
    const userParts = [];

    for (const msg of messages) {
        if (msg.role === "system") {
            systemParts.push(msg.content);
        } else if (msg.role === "user") {
            userParts.push(msg.content);
        } else if (msg.role === "assistant") {
            userParts.push(`(Previous response: ${msg.content})`);
        }
    }

    const parts = [];
    if (systemParts.length > 0) {
        parts.push(`[System Instructions]\n${systemParts.join("\n")}`);
    }
    if (userParts.length > 0) {
        parts.push(`[User Message]\n${userParts.join("\n")}`);
    }

    return parts.join("\n\n");
}

/**
 * Extract a value from a JSON response using a dot-notation field path.
 */
function extractAnswer(data, fieldPath) {
    const parts = fieldPath.split(".");
    let current = data;

    for (const part of parts) {
        if (current === null || current === undefined) {
            throw new Error(`Cannot extract "${fieldPath}" from response — "${part}" is ${current}`);
        }
        const index = parseInt(part, 10);
        if (!isNaN(index) && Array.isArray(current)) {
            current = current[index];
        } else {
            current = current[part];
        }
    }

    if (typeof current !== "string") {
        if (current && typeof current === "object") {
            return current.content || current.text || current.message || JSON.stringify(current);
        }
        return String(current);
    }

    return current;
}

/**
 * Remove expired sessions to prevent memory leak.
 */
function cleanupSessions() {
    const now = Date.now();
    for (const [key, session] of sessions) {
        if (now - session.timestamp > SESSION_TTL_MS) {
            sessions.delete(key);
        }
    }
}
