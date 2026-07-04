import { config } from "../config.js";

const REQUEST_TIMEOUT_MS = 55000;

export async function chatCompletion(messages, modelOverride = null, isComplex = false) {
    const covenant = config.ai?.covenant;
    if (!covenant?.apiKey) throw new Error("Covenant API key not configured (set OPENX_COVENANT_API_KEY)");

    const model = modelOverride || covenant.model || "google/gemini-2.5-flash";

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
        apikey: covenant.apiKey,
        messages: [{ id: Date.now(), role: "user", parts }],
        model,
        isDeepResearchMode: false,
        isWebSearchMode: false,
        isImageGenerationMode: false,
        isAgenticMode: false,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        console.log(`[Covenant] POST ${covenant.baseUrl} model=${model}`);

        const response = await fetch(covenant.baseUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        console.log(`[Covenant] Response: ${response.status}`);

        if (!response.ok) {
            const errBody = await response.text().catch(() => "");
            throw new Error(`Covenant API error: ${response.status} - ${errBody.slice(0, 200)}`);
        }

        const data = await response.json();

        if (!data.status) {
            throw new Error(`Covenant API error: ${data.message || 'Unknown error'}`);
        }

        const content = data.data?.result || "";
        console.log(`[Covenant] Success: ${content.length} chars, remaining: ${data.usage?.remaining}`);

        return content;
    } finally {
        clearTimeout(timeoutId);
    }
}
