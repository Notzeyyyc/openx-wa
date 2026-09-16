import { config } from './config.js';

const REQUEST_TIMEOUT_MS = 55000;

/**
 * Single OpenAI-compatible chat provider.
 * profile: { baseUrl, apiKey, model } — point baseUrl at any
 * /v1/chat/completions-compatible API (sumopod, OpenRouter, etc).
 */
export async function chatCompletion(profile, messages, isComplex = false) {
    const baseUrl = profile?.baseUrl || config.ai.openai.baseUrl;
    const apiKey = profile?.apiKey || config.ai.openai.apiKey;
    const model = profile?.model || config.ai.openai.model;
    if (!baseUrl) throw new Error("AI base URL not configured (set OPENX_OPENAI_BASE_URL or use .ai url)");

    const url = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
            model,
            messages: messages.map(m => ({ role: m.role, content: m.content })),
            temperature: isComplex ? 0.7 : 0.5,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        const err = new Error(`AI API error: ${response.status} ${response.statusText} - ${errBody.slice(0, 200)}`);
        err.status = response.status;
        throw err;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
}
