import { config } from '../config.js';

/**
 * Generate image using FGSi isImageGenerationMode endpoint
 */
export async function generateImage(prompt) {
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
                messages: [{ id: Date.now(), role: 'user', parts: [{ type: 'text', text: prompt }] }],
                isImageGenerationMode: true
            }),
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
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}
