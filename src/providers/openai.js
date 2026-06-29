import { config } from "../config.js";

const REQUEST_TIMEOUT_MS = 55000;

/**
 * OpenAI-compatible API provider.
 * Works with any API that follows OpenAI's /v1/chat/completions format.
 * Default: https://ai.sumopod.com
 */
export async function chatCompletion(messages, modelOverride = null, isComplex = false) {
    const openai = config.ai?.openai;
    if (!openai?.baseUrl) throw new Error("OpenAI base URL not configured (set OPENX_OPENAI_BASE_URL)");

    const model = modelOverride || openai.model || "gpt-4o-mini";
    const url = `${openai.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;

    const body = {
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: isComplex ? 0.7 : 0.5,
    };

    const headers = {
        "Content-Type": "application/json",
    };
    if (openai.apiKey) {
        headers["Authorization"] = `Bearer ${openai.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        console.log(`[OpenAI] POST ${url} model=${model} msgs=${messages.length}`);

        const response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        console.log(`[OpenAI] Response: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errBody = await response.text().catch(() => "");
            const err = new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errBody.slice(0, 200)}`);
            err.status = response.status;
            throw err;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "";
        console.log(`[OpenAI] Success: ${content.length} chars`);
        return content;
    } finally {
        clearTimeout(timeoutId);
    }
}
