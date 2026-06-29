const MUSIC_API_BASE = "https://api.zelapi.eu.cc";

export async function searchAndDownload(query, apikey) {
    const url = `${MUSIC_API_BASE}/download/ytplay?q=${encodeURIComponent(query)}&apikey=${apikey}`;

    const res = await fetch(url);
    const data = await res.json();

    if (!data.status || !data.audio_url) {
        return { ok: false, error: "Lagu tidak ditemukan" };
    }

    return {
        ok: true,
        title: data.title,
        channel: data.channel,
        duration: data.duration,
        thumbnail: data.thumbnail,
        audioUrl: data.audio_url,
    };
}
