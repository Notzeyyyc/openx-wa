package browser

import (
	"sync"
	"time"
)

// CacheEntry represents a single cached response.
type CacheEntry struct {
	Value     string
	CreatedAt time.Time
	TTL       time.Duration
}

// IsExpired returns true if the cache entry has exceeded its TTL.
func (ce *CacheEntry) IsExpired() bool {
	return time.Since(ce.CreatedAt) > ce.TTL
}

// ResponseCache provides a bounded, thread-safe LRU cache for HTTP responses.
// It prevents duplicate requests and limits memory usage with max entries and TTL.
type ResponseCache struct {
	mu         sync.RWMutex
	entries    map[string]*CacheEntry
	order      []string // LRU order (oldest first)
	maxEntries int
	defaultTTL time.Duration
}

// NewResponseCache creates a new bounded response cache.
func NewResponseCache(maxEntries int, defaultTTL time.Duration) *ResponseCache {
	return &ResponseCache{
		entries:    make(map[string]*CacheEntry),
		order:      make([]string, 0),
		maxEntries: maxEntries,
		defaultTTL: defaultTTL,
	}
}

// Get retrieves a cached response by key. Returns empty string and false if not found or expired.
func (rc *ResponseCache) Get(key string) (string, bool) {
	rc.mu.RLock()
	entry, exists := rc.entries[key]
	rc.mu.RUnlock()

	if !exists {
		return "", false
	}

	if entry.IsExpired() {
		// Remove expired entry
		rc.mu.Lock()
		rc.removeEntry(key)
		rc.mu.Unlock()
		return "", false
	}

	// Move to end of LRU order (most recently used)
	rc.mu.Lock()
	rc.moveToEnd(key)
	rc.mu.Unlock()

	return entry.Value, true
}

// Set stores a response in the cache. Evicts oldest entries if over capacity.
func (rc *ResponseCache) Set(key, value string) {
	rc.SetWithTTL(key, value, rc.defaultTTL)
}

// SetWithTTL stores a response with a custom TTL.
func (rc *ResponseCache) SetWithTTL(key, value string, ttl time.Duration) {
	rc.mu.Lock()
	defer rc.mu.Unlock()

	// If key already exists, update it
	if _, exists := rc.entries[key]; exists {
		rc.entries[key] = &CacheEntry{
			Value:     value,
			CreatedAt: time.Now(),
			TTL:       ttl,
		}
		rc.moveToEnd(key)
		return
	}

	// Evict oldest if at capacity
	for len(rc.entries) >= rc.maxEntries && len(rc.order) > 0 {
		rc.evictOldest()
	}

	// Add new entry
	rc.entries[key] = &CacheEntry{
		Value:     value,
		CreatedAt: time.Now(),
		TTL:       ttl,
	}
	rc.order = append(rc.order, key)
}

// Delete removes a specific entry from the cache.
func (rc *ResponseCache) Delete(key string) {
	rc.mu.Lock()
	defer rc.mu.Unlock()
	rc.removeEntry(key)
}

// Clear removes all entries from the cache.
func (rc *ResponseCache) Clear() {
	rc.mu.Lock()
	defer rc.mu.Unlock()

	rc.entries = make(map[string]*CacheEntry)
	rc.order = make([]string, 0)
}

// Size returns the current number of entries in the cache.
func (rc *ResponseCache) Size() int {
	rc.mu.RLock()
	defer rc.mu.RUnlock()
	return len(rc.entries)
}

// Cleanup removes all expired entries. Call periodically to free memory.
func (rc *ResponseCache) Cleanup() int {
	rc.mu.Lock()
	defer rc.mu.Unlock()

	removed := 0
	for key, entry := range rc.entries {
		if entry.IsExpired() {
			rc.removeEntry(key)
			removed++
		}
	}
	return removed
}

// evictOldest removes the oldest entry (first in order slice).
// Must be called with lock held.
func (rc *ResponseCache) evictOldest() {
	if len(rc.order) == 0 {
		return
	}
	oldest := rc.order[0]
	rc.order = rc.order[1:]
	delete(rc.entries, oldest)
}

// removeEntry removes an entry by key from both map and order slice.
// Must be called with lock held.
func (rc *ResponseCache) removeEntry(key string) {
	delete(rc.entries, key)
	for i, k := range rc.order {
		if k == key {
			rc.order = append(rc.order[:i], rc.order[i+1:]...)
			break
		}
	}
}

// moveToEnd moves a key to the end of the order slice (most recently used).
// Must be called with lock held.
func (rc *ResponseCache) moveToEnd(key string) {
	for i, k := range rc.order {
		if k == key {
			rc.order = append(rc.order[:i], rc.order[i+1:]...)
			rc.order = append(rc.order, key)
			break
		}
	}
}
