import { config } from "../config.js";

const REQUEST_TIMEOUT_MS = 55000;

const VALID_MODELS = [
    "google/gemini-2.5-flash",
    "google/gemini-2.5-pro",
    "google/gemini-2.5-flash-image",
    "google/gemini-3-pro-preview",
    "google/gemini-3-pro-image-preview",
    "google/gemini-3.1-pro",
];

export async function chatCompletion(messages, modelOverride = null, isComplex = false) {
    const gemini = config.ai?.gemini;
    if (!gemini?.apiKey) throw new Error("Gemini API key not configured (set OPENX_GEMINI_API_KEY)");

    const model = VALID_MODELS.includes(modelOverride) ? modelOverride : (gemini.model || "google/gemini-2.5-flash");

    const parts = [];
    for (const msg of messages) {
        if (msg.role === "system") {
            parts.push({ type: "text", text: `[System] ${msg.content}` });
        } else if (msg.role === "user") {
            parts.push({ type: "text", text: msg.content });
        } else if (msg.role === "assistant") {
            parts.push({ type: "text", text: `[Assistant] ${msg.content}` });
        }
    }

    const body = {
        apikey: gemini.apiKey,
        messages: [{ id: Date.now(), role: "user", parts }],
        model,
        isDeepResearchMode: isComplex && gemini.deepResearch,
        isWebSearchMode: gemini.webSearch || false,
        isImageGenerationMode: false,
        isAgenticMode: false,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        console.log(`[Gemini] POST model=${model}`);
        const response = await fetch(gemini.baseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        console.log(`[Gemini] Response: ${response.status}`);
        if (!response.ok) {
            const errBody = await response.text().catch(() => "");
            throw new Error(`Gemini API error: ${response.status} - ${errBody.slice(0, 200)}`);
        }

        const data = await response.json();
        let content = "";

        // FGSi format: { data: { text, chatId } }
        if (data.data?.text) {
            content = data.data.text;
        }
        // Standard format
        else if (data.data) {
            if (typeof data.data === "string") content = data.data;
            else if (typeof data.data === "object") {
                content = data.data.response || data.data.content || data.data.message || data.data.choices?.[0]?.message?.content || JSON.stringify(data.data);
            }
        } else {
            content = data.response || data.content || data.message || "";
        }

        console.log(`[Gemini] Success: ${content.length} chars`);
        return content;
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Generate image using Gemini
 */
export async function generateImage(prompt) {
    const gemini = config.ai?.gemini;
    if (!gemini?.apiKey) throw new Error("Gemini API key not configured");

    const body = {
        apikey: gemini.apiKey,
        messages: [{ id: Date.now(), role: "user", parts: [{ type: "text", text: prompt }] }],
        model: "google/gemini-2.5-flash-image",
        isImageGenerationMode: true,
    };

    const response = await fetch(gemini.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(body),
    });

    const data = await response.json();
    return data.data?.url || data.data?.response || data.data?.content || "";
}
