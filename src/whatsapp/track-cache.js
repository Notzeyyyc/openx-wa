/**
 * Track cache for music search results
 * Maps cache IDs to track data for quick retrieval
 */

const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cacheSeq = 1;

/**
 * Save search results to cache
 * Returns array of cache IDs
 */
export function cacheSearchResults(results) {
    const ids = [];
    for (const track of results) {
        const id = `track_${cacheSeq++}`;
        cache.set(id, {
            ...track,
            cachedAt: Date.now()
        });
        ids.push(id);
    }
    return ids;
}

/**
 * Get cached track by ID
 */
export function getCachedTrack(id) {
    const track = cache.get(id);
    if (!track) return null;

    // Check TTL
    if (Date.now() - track.cachedAt > CACHE_TTL_MS) {
        cache.delete(id);
        return null;
    }

    return track;
}

/**
 * Clean expired entries
 */
export function cleanCache() {
    const now = Date.now();
    for (const [id, track] of cache) {
        if (now - track.cachedAt > CACHE_TTL_MS) {
            cache.delete(id);
        }
    }
}

// Auto-clean every 5 minutes
setInterval(cleanCache, CACHE_TTL_MS);
