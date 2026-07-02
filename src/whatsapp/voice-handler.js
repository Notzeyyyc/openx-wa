import { config } from '../config.js';

const TTS_API = "https://fgsi.dpdns.org/api/ai/clonevoice/text-to-speech";

/**
 * Convert text to voice note using FongsiDev TTS API
 * @param {string} text - Text to convert
 * @param {string} voiceId - Voice ID (default: Furina)
 * @returns {Buffer|null} Audio buffer or null on failure
 */
export async function textToSpeech(text, voiceId = null) {
    const apiKey = process.env.OPENX_TTS_API_KEY || process.env.OPENX_CLAUDE_API_KEY || '';
    const voice = voiceId || process.env.OPENX_TTS_VOICE || 'voice_furina_';

    if (!apiKey) {
        console.log('[TTS] No API key configured');
        return null;
    }

    try {
        const url = new URL(TTS_API);
        url.searchParams.set('apikey', apiKey);
        url.searchParams.set('text', text.slice(0, 500)); // Limit text length
        url.searchParams.set('voice_id', voice);

        console.log(`[TTS] Converting ${text.length} chars with voice ${voice}`);

        const response = await fetch(url.toString(), {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
            console.log(`[TTS] Error: ${response.status}`);
            return null;
        }

        const data = await response.json();

        if (!data.status || !data.data) {
            console.log('[TTS] No audio data returned');
            return null;
        }

        // data.data might be a URL or base64
        if (typeof data.data === 'string' && data.data.startsWith('http')) {
            const audioRes = await fetch(data.data);
            if (!audioRes.ok) return null;
            return Buffer.from(await audioRes.arrayBuffer());
        }

        // Base64 audio
        if (typeof data.data === 'string') {
            return Buffer.from(data.data, 'base64');
        }

        return null;
    } catch (e) {
        console.error('[TTS] Failed:', e.message);
        return null;
    }
}

/**
 * Send text as voice note
 */
export async function sendVoiceNote(waSock, jid, text, quoted) {
    const buffer = await textToSpeech(text);
    if (!buffer) return false;

    await waSock.sendMessage(jid, {
        audio: buffer,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true, // true = voice note, false = audio file
    }, { quoted }).catch(() => {});

    return true;
}

/**
 * Get list of available voices
 */
export async function getVoiceList() {
    const apiKey = process.env.OPENX_TTS_API_KEY || process.env.OPENX_CLAUDE_API_KEY || '';
    if (!apiKey) return [];

    try {
        const url = `https://fgsi.dpdns.org/api/ai/clonevoice/listvoices?apikey=${apiKey}`;
        const res = await fetch(url);
        const data = await res.json();
        return data.data || [];
    } catch {
        return [];
    }
}
