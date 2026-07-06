const COVENANT_API = "https://api.covenant.sbs/api/spotify";

/**
 * Search for songs
 */
export async function searchSongs(query, limit = 5) {
    const apiKey = process.env.OPENX_SPOTIFY_API_KEY || '';
    if (!apiKey) return { ok: false, error: "Spotify API key not set" };

    try {
        const url = `${COVENANT_API}/search?q=${encodeURIComponent(query)}&limit=${limit}`;
        const res = await fetch(url, {
            headers: { 'x-api-key': apiKey }
        });
        const data = await res.json();

        if (!data.status || !data.data?.results) {
            return { ok: false, error: data.message || 'Search failed' };
        }

        return { ok: true, results: data.data.results };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/**
 * Download song using preview_url directly
 */
export async function downloadSong(query) {
    const apiKey = process.env.OPENX_SPOTIFY_API_KEY || '';
    if (!apiKey) return { ok: false, error: "Spotify API key not set" };

    try {
        // Search to get song info + preview URL
        const searchResult = await searchSongs(query, 1);
        if (!searchResult.ok || !searchResult.results?.[0]) {
            return { ok: false, error: 'Song not found' };
        }

        const song = searchResult.results[0];

        // Use preview_url directly (Deezer CDN, reliable)
        let audioUrl = song.preview_url;

        // If no preview, try download endpoint with search URL
        if (!audioUrl) {
            const downloadUrl = `${COVENANT_API}/download?q=${encodeURIComponent(query)}&url=${encodeURIComponent(song.spotify_search_url || '')}`;
            const res = await fetch(downloadUrl, {
                headers: { 'x-api-key': apiKey }
            });
            const data = await res.json();
            audioUrl = data.data?.audio_url;
        }

        if (!audioUrl) {
            return { ok: false, error: 'No audio URL found' };
        }

        return {
            ok: true,
            title: song.title || query,
            artist: song.artists || 'Unknown',
            album: song.album || '',
            duration: song.duration || '',
            image: song.cover || '',
            downloadUrl: audioUrl
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/**
 * Download by specific track URL
 */
export async function downloadByTrackUrl(trackUrl) {
    const apiKey = process.env.OPENX_SPOTIFY_API_KEY || '';
    if (!apiKey) return { ok: false, error: "Spotify API key not set" };

    try {
        const url = `${COVENANT_API}/download?url=${encodeURIComponent(trackUrl)}`;
        const res = await fetch(url, {
            headers: { 'x-api-key': apiKey }
        });
        const data = await res.json();

        if (!data.status || !data.data?.audio_url) {
            return { ok: false, error: data.message || 'Download failed' };
        }

        return {
            ok: true,
            title: data.data.title || 'Unknown',
            artist: data.data.artist || 'Unknown',
            album: data.data.album || '',
            duration: data.data.duration_sec ? `${Math.floor(data.data.duration_sec / 60)}:${String(data.data.duration_sec % 60).padStart(2, '0')}` : '',
            image: data.data.cover || '',
            downloadUrl: data.data.audio_url
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/**
 * Get album info
 */
export async function getAlbumInfo(albumId) {
    const apiKey = process.env.OPENX_SPOTIFY_API_KEY || '';
    if (!apiKey) return { ok: false, error: "Spotify API key not set" };

    try {
        const url = `${COVENANT_API}/album?id=${albumId}`;
        const res = await fetch(url, { headers: { 'x-api-key': apiKey } });
        const data = await res.json();
        if (!data.status) return { ok: false, error: data.message || 'Failed' };
        return { ok: true, data: data.data || data };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/**
 * Get artist info
 */
export async function getArtistInfo(artistId) {
    const apiKey = process.env.OPENX_SPOTIFY_API_KEY || '';
    if (!apiKey) return { ok: false, error: "Spotify API key not set" };

    try {
        const url = `${COVENANT_API}/artist?id=${artistId}`;
        const res = await fetch(url, { headers: { 'x-api-key': apiKey } });
        const data = await res.json();
        if (!data.status) return { ok: false, error: data.message || 'Failed' };
        return { ok: true, data: data.data || data };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}
