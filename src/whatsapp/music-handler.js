const COVENANT_API = "https://api.covenant.sbs/api/spotify";

/**
 * Search for songs on Spotify
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

        if (!data.status) {
            return { ok: false, error: data.message || 'Search failed' };
        }

        return { ok: true, results: data.data || data };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/**
 * Get song details by Spotify URL
 */
export async function getSongInfo(spotifyUrl) {
    const apiKey = process.env.OPENX_SPOTIFY_API_KEY || '';
    if (!apiKey) return { ok: false, error: "Spotify API key not set" };

    try {
        const url = `${COVENANT_API}/download?url=${encodeURIComponent(spotifyUrl)}`;
        const res = await fetch(url, {
            headers: { 'x-api-key': apiKey }
        });
        const data = await res.json();

        if (!data.status) {
            return { ok: false, error: data.message || 'Failed to get song info' };
        }

        return { ok: true, data: data.data || data };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/**
 * Download song from Spotify
 */
export async function downloadSong(query) {
    const apiKey = process.env.OPENX_SPOTIFY_API_KEY || '';
    if (!apiKey) return { ok: false, error: "Spotify API key not set" };

    try {
        // Search first
        const searchResult = await searchSongs(query, 1);
        if (!searchResult.ok || !searchResult.results?.[0]) {
            return { ok: false, error: 'Song not found' };
        }

        const song = searchResult.results[0];
        const spotifyUrl = song.url || song.external_urls?.spotify;

        if (!spotifyUrl) {
            return { ok: false, error: 'No Spotify URL found' };
        }

        // Get download URL
        const url = `${COVENANT_API}/download?q=${encodeURIComponent(query)}&url=${encodeURIComponent(spotifyUrl)}`;
        const res = await fetch(url, {
            headers: { 'x-api-key': apiKey }
        });
        const data = await res.json();

        if (!data.status) {
            return { ok: false, error: data.message || 'Download failed' };
        }

        return {
            ok: true,
            title: song.name || song.title || query,
            artist: song.artist || song.artists?.[0]?.name || 'Unknown',
            album: song.album || song.album?.name || '',
            duration: song.duration || '',
            image: song.image || song.album?.images?.[0]?.url || '',
            downloadUrl: data.data?.url || data.data?.download_url || data.url,
            spotifyUrl
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
        const res = await fetch(url, {
            headers: { 'x-api-key': apiKey }
        });
        const data = await res.json();

        if (!data.status) {
            return { ok: false, error: data.message || 'Failed to get album' };
        }

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
        const res = await fetch(url, {
            headers: { 'x-api-key': apiKey }
        });
        const data = await res.json();

        if (!data.status) {
            return { ok: false, error: data.message || 'Failed to get artist' };
        }

        return { ok: true, data: data.data || data };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}
