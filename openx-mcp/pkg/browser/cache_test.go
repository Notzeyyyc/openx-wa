package browser

import (
	"testing"
	"time"
)

func TestCacheSetAndGet(t *testing.T) {
	cache := NewResponseCache(10, 5*time.Minute)

	cache.Set("key1", "value1")

	val, found := cache.Get("key1")
	if !found {
		t.Fatal("key should be found")
	}
	if val != "value1" {
		t.Errorf("value = %q, want %q", val, "value1")
	}
}

func TestCacheGetNotFound(t *testing.T) {
	cache := NewResponseCache(10, 5*time.Minute)

	_, found := cache.Get("nonexistent")
	if found {
		t.Error("key should not be found")
	}
}

func TestCacheExpiration(t *testing.T) {
	cache := NewResponseCache(10, 50*time.Millisecond)

	cache.Set("key1", "value1")

	// Should be found immediately
	_, found := cache.Get("key1")
	if !found {
		t.Fatal("key should be found before expiration")
	}

	// Wait for expiration
	time.Sleep(100 * time.Millisecond)

	_, found = cache.Get("key1")
	if found {
		t.Error("key should be expired")
	}
}

func TestCacheEviction(t *testing.T) {
	cache := NewResponseCache(3, 5*time.Minute)

	cache.Set("key1", "value1")
	cache.Set("key2", "value2")
	cache.Set("key3", "value3")

	// Adding a 4th should evict the oldest (key1)
	cache.Set("key4", "value4")

	_, found := cache.Get("key1")
	if found {
		t.Error("key1 should have been evicted")
	}

	_, found = cache.Get("key4")
	if !found {
		t.Error("key4 should be present")
	}

	if cache.Size() != 3 {
		t.Errorf("size = %d, want 3", cache.Size())
	}
}

func TestCacheLRUOrder(t *testing.T) {
	cache := NewResponseCache(3, 5*time.Minute)

	cache.Set("key1", "value1")
	cache.Set("key2", "value2")
	cache.Set("key3", "value3")

	// Access key1 to make it most recently used
	cache.Get("key1")

	// Adding key4 should evict key2 (oldest unused)
	cache.Set("key4", "value4")

	_, found := cache.Get("key1")
	if !found {
		t.Error("key1 should still be present (was recently accessed)")
	}

	_, found = cache.Get("key2")
	if found {
		t.Error("key2 should have been evicted (oldest unused)")
	}
}

func TestCacheUpdate(t *testing.T) {
	cache := NewResponseCache(10, 5*time.Minute)

	cache.Set("key1", "value1")
	cache.Set("key1", "value2") // Update

	val, found := cache.Get("key1")
	if !found {
		t.Fatal("key should be found")
	}
	if val != "value2" {
		t.Errorf("value = %q, want %q", val, "value2")
	}

	// Should not have duplicates
	if cache.Size() != 1 {
		t.Errorf("size = %d, want 1", cache.Size())
	}
}

func TestCacheClear(t *testing.T) {
	cache := NewResponseCache(10, 5*time.Minute)

	cache.Set("key1", "value1")
	cache.Set("key2", "value2")

	cache.Clear()

	if cache.Size() != 0 {
		t.Errorf("size = %d, want 0", cache.Size())
	}
}

func TestCacheDelete(t *testing.T) {
	cache := NewResponseCache(10, 5*time.Minute)

	cache.Set("key1", "value1")
	cache.Set("key2", "value2")

	cache.Delete("key1")

	_, found := cache.Get("key1")
	if found {
		t.Error("key1 should be deleted")
	}

	_, found = cache.Get("key2")
	if !found {
		t.Error("key2 should still be present")
	}
}

func TestCacheCleanup(t *testing.T) {
	cache := NewResponseCache(10, 50*time.Millisecond)

	cache.Set("key1", "value1")
	cache.Set("key2", "value2")

	time.Sleep(100 * time.Millisecond)

	// Add a fresh entry
	cache.SetWithTTL("key3", "value3", 5*time.Minute)

	removed := cache.Cleanup()
	if removed != 2 {
		t.Errorf("removed = %d, want 2", removed)
	}

	if cache.Size() != 1 {
		t.Errorf("size = %d, want 1", cache.Size())
	}
}
