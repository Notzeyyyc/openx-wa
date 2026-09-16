import { config } from '../config.js';

/**
 * Web search using FGSi isWebSearchMode endpoint
 */
export async function webSearch(query) {
    const { baseUrl, apiKey } = config.fgsi;
    if (!baseUrl || !apiKey) {
        return { ok: false, error: 'FGSI API not configured (set OPENX_FGSI_API_KEY)' };
    }

    try {
        const res = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
                apikey: apiKey,
                messages: [{ id: Date.now(), role: 'user', parts: [{ type: 'text', text: query }] }],
                isWebSearchMode: true
            }),
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
