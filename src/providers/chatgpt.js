import { config } from "../config.js";

const REQUEST_TIMEOUT_MS = 55000;

const VALID_MODELS = [
    "openai/gpt-5.1-thinking",
    "openai/gpt-5-chat",
    "openai/gpt-5-nano",
    "openai/gpt-5-mini",
    "openai/o1",
    "openai/o3",
    "openai/o3-mini",
    "openai/gpt-4o",
    "openai/o4-mini",
    "openai/gpt-4-1-mini",
    "openai/gpt-4-1-nano",
    "openai/gpt-5.3-chat",
    "openai/gpt-5.4",
    "openai/gpt-5.5",
];

export async function chatCompletion(messages, modelOverride = null, isComplex = false) {
    const chatgpt = config.ai?.chatgpt;
    if (!chatgpt?.apiKey) throw new Error("ChatGPT API key not configured (set OPENX_CHATGPT_API_KEY)");

    const model = VALID_MODELS.includes(modelOverride) ? modelOverride : (chatgpt.model || "openai/gpt-4o");

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
        apikey: chatgpt.apiKey,
        messages: [{ id: Date.now(), role: "user", parts }],
        model,
        isDeepResearchMode: isComplex && chatgpt.deepResearch,
        isWebSearchMode: chatgpt.webSearch || false,
        isImageGenerationMode: false,
        isAgenticMode: false,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        console.log(`[ChatGPT] POST model=${model}`);
        const response = await fetch(chatgpt.baseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        console.log(`[ChatGPT] Response: ${response.status}`);
        if (!response.ok) {
            const errBody = await response.text().catch(() => "");
            throw new Error(`ChatGPT API error: ${response.status} - ${errBody.slice(0, 200)}`);
        }

        const data = await response.json();
        let content = "";
        if (data.data) {
            if (typeof data.data === "string") content = data.data;
            else if (typeof data.data === "object") {
                content = data.data.response || data.data.content || data.data.message || data.data.choices?.[0]?.message?.content || JSON.stringify(data.data);
            }
        } else {
            content = data.response || data.content || data.message || "";
        }

        console.log(`[ChatGPT] Success: ${content.length} chars`);
        return content;
    } finally {
        clearTimeout(timeoutId);
    }
}
