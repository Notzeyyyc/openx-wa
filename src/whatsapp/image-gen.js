import { config } from '../config.js';

/**
 * Generate image using AI provider with isImageGenerationMode
 */
export async function generateImage(prompt) {
    const provider = config.ai?.provider || 'openai';
    const baseUrl = config.ai?.[provider]?.baseUrl || '';
    const apiKey = config.ai?.[provider]?.apiKey || '';

    if (!baseUrl || !apiKey) {
        return { ok: false, error: 'API not configured' };
    }

    try {
        const body = {
            apikey: apiKey,
            messages: [{ id: Date.now(), role: 'user', parts: [{ type: 'text', text: prompt }] }],
            model: config.ai?.[provider]?.model || '',
            isDeepResearchMode: false,
            isWebSearchMode: false,
            isImageGenerationMode: true,
            isAgenticMode: false
        };

        const res = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60000)
        });

        const data = await res.json();

        if (!data.status) {
            return { ok: false, error: data.message || 'Generation failed' };
        }

        const images = data.data?.images || [];
        const text = data.data?.text || '';

        if (images.length === 0 && !text) {
            return { ok: false, error: 'No image generated' };
        }

        return {
            ok: true,
            imageUrl: images[0]?.url || null,
            text: text || null,
            width: images[0]?.width || 0,
            height: images[0]?.height || 0
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}
