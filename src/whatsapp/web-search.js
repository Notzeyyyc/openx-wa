import { config } from '../config.js';

/**
 * Web search using AI provider with isWebSearchMode
 */
export async function webSearch(query) {
    const provider = config.ai?.provider || 'openai';
    const baseUrl = config.ai?.[provider]?.baseUrl || '';
    const apiKey = config.ai?.[provider]?.apiKey || '';

    if (!baseUrl || !apiKey) {
        return { ok: false, error: 'API not configured' };
    }

    try {
        const body = {
            apikey: apiKey,
            messages: [{ id: Date.now(), role: 'user', parts: [{ type: 'text', text: query }] }],
            model: config.ai?.[provider]?.model || '',
            isDeepResearchMode: false,
            isWebSearchMode: true,
            isImageGenerationMode: false,
            isAgenticMode: false
        };

        const res = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30000)
        });

        const data = await res.json();
        const text = data.data?.text || '';

        if (!text) {
            return { ok: false, error: 'No results found' };
        }

        return { ok: true, text, chatId: data.data?.chatId };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}
