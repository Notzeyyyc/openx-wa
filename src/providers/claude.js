import { config } from "../config.js";

const REQUEST_TIMEOUT_MS = 55000;

// Valid Claude models
const VALID_CLAUDE_MODELS = [
    "anthropic/claude-opus-4",
    "anthropic/claude-sonnet-4",
    "anthropic/claude-sonnet-4.5",
    "anthropic/claude-opus-4.8",
];

/**
 * Claude API provider (FongsiDev REST API).
 * Supports: text, vision, image generation, web search, deep research.
 */
export async function chatCompletion(messages, modelOverride = null, isComplex = false) {
    const claude = config.ai?.claude;
    if (!claude?.baseUrl) throw new Error("Claude base URL not configured (set OPENX_CLAUDE_BASE_URL)");
    if (!claude?.apiKey) throw new Error("Claude API key not configured (set OPENX_CLAUDE_API_KEY)");

    // Use override only if it's a valid Claude model, otherwise use config default
    let model = claude.model || "anthropic/claude-opus-4.8";
    if (modelOverride && VALID_CLAUDE_MODELS.includes(modelOverride)) {
        model = modelOverride;
    }

    // Convert messages to Claude format
    const parts = [];
    for (const msg of messages) {
        if (msg.role === "system") {
            parts.push({ type: "text", text: `[System] ${msg.content}` });
        } else if (msg.role === "user") {
            parts.push({ type: "text", text: msg.content });
        } else if (msg.role === "assistant") {
            parts.push({ type: "text", text: `[Assistant previously said] ${msg.content}` });
        }
    }

    const body = {
        apikey: claude.apiKey,
        messages: [{
            id: Date.now(),
            role: "user",
            parts
        }],
        model,
        isDeepResearchMode: isComplex && claude.deepResearch,
        isWebSearchMode: claude.webSearch || false,
        isImageGenerationMode: false,
        isAgenticMode: false,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        console.log(`[Claude] POST ${claude.baseUrl} model=${model} msgs=${messages.length}`);

        const response = await fetch(claude.baseUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        console.log(`[Claude] Response: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errBody = await response.text().catch(() => "");
            const err = new Error(`Claude API error: ${response.status} ${response.statusText} - ${errBody.slice(0, 200)}`);
            err.status = response.status;
            throw err;
        }

        const data = await response.json();
        console.log(`[Claude] Raw response keys: ${Object.keys(data).join(', ')}`);

        // Response structure: { developer, status, data: { ... }, message }
        let content = "";

        if (data.data) {
            // data.data might be: string, { response }, { content }, { choices }, etc
            if (typeof data.data === "string") {
                content = data.data;
            } else if (typeof data.data === "object") {
                console.log(`[Claude] data.data keys: ${Object.keys(data.data).join(', ')}`);
                content = data.data.response
                    || data.data.content
                    || data.data.message
                    || data.data.choices?.[0]?.message?.content
                    || data.data.text
                    || JSON.stringify(data.data);
            }
        } else {
            content = data.response
                || data.content
                || data.message
                || "";
        }

        console.log(`[Claude] Extracted content length: ${content.length}`);

        console.log(`[Claude] Success: ${content.length} chars`);
        return content;
    } finally {
        clearTimeout(timeoutId);
    }
}
