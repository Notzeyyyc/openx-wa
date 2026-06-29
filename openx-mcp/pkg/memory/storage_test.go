package memory

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/notzeyyc/openx-v2/pkg/logging"
)

func init() {
	logging.Init(logging.LoggerConfig{
		Level:  "error",
		Format: "text",
		Output: "stderr",
	})
}

func tempStoragePath(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	return filepath.Join(dir, "test-memory.json")
}

func TestNewMemoryStorage(t *testing.T) {
	path := tempStoragePath(t)
	ms, err := NewMemoryStorage(path, 1024*1024, false, 3)
	if err != nil {
		t.Fatalf("NewMemoryStorage failed: %v", err)
	}
	if ms == nil {
		t.Fatal("storage should not be nil")
	}
}

func TestSetAndGet(t *testing.T) {
	path := tempStoragePath(t)
	ms, _ := NewMemoryStorage(path, 1024*1024, false, 3)

	// Set a string value
	if err := ms.Set("name", "Alice"); err != nil {
		t.Fatalf("Set failed: %v", err)
	}

	// Get it back
	val, found, err := ms.Get("name")
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if !found {
		t.Fatal("key should be found")
	}
	if val != "Alice" {
		t.Errorf("value = %v, want 'Alice'", val)
	}
}

func TestSetAndGetComplex(t *testing.T) {
	path := tempStoragePath(t)
	ms, _ := NewMemoryStorage(path, 1024*1024, false, 3)

	// Set a complex value
	data := map[string]interface{}{
		"items": []interface{}{"a", "b", "c"},
		"count": float64(3),
	}
	if err := ms.Set("complex", data); err != nil {
		t.Fatalf("Set failed: %v", err)
	}

	val, found, _ := ms.Get("complex")
	if !found {
		t.Fatal("key should be found")
	}
	m, ok := val.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map, got %T", val)
	}
	if m["count"] != float64(3) {
		t.Errorf("count = %v, want 3", m["count"])
	}
}

func TestGetNotFound(t *testing.T) {
	path := tempStoragePath(t)
	ms, _ := NewMemoryStorage(path, 1024*1024, false, 3)

	_, found, err := ms.Get("nonexistent")
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if found {
		t.Error("key should not be found")
	}
}

func TestDelete(t *testing.T) {
	path := tempStoragePath(t)
	ms, _ := NewMemoryStorage(path, 1024*1024, false, 3)

	ms.Set("key1", "value1")

	deleted, err := ms.Delete("key1")
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if !deleted {
		t.Error("key should have been deleted")
	}

	_, found, _ := ms.Get("key1")
	if found {
		t.Error("key should not be found after deletion")
	}
}

func TestDeleteNotFound(t *testing.T) {
	path := tempStoragePath(t)
	ms, _ := NewMemoryStorage(path, 1024*1024, false, 3)

	deleted, err := ms.Delete("nonexistent")
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if deleted {
		t.Error("should not report deletion of nonexistent key")
	}
}

func TestClear(t *testing.T) {
	path := tempStoragePath(t)
	ms, _ := NewMemoryStorage(path, 1024*1024, false, 3)

	ms.Set("key1", "value1")
	ms.Set("key2", "value2")
	ms.Set("key3", "value3")

	if err := ms.Clear(); err != nil {
		t.Fatalf("Clear failed: %v", err)
	}

	if ms.Count() != 0 {
		t.Errorf("count = %d, want 0", ms.Count())
	}
}

func TestList(t *testing.T) {
	path := tempStoragePath(t)
	ms, _ := NewMemoryStorage(path, 1024*1024, false, 3)

	ms.Set("user_name", "Alice")
	ms.Set("user_age", 30)
	ms.Set("config_theme", "dark")

	// List all
	keys, _ := ms.List("*")
	if len(keys) != 3 {
		t.Errorf("list * = %d keys, want 3", len(keys))
	}

	// List with prefix pattern
	keys, _ = ms.List("user_*")
	if len(keys) != 2 {
		t.Errorf("list user_* = %d keys, want 2", len(keys))
	}

	// List with specific pattern
	keys, _ = ms.List("config_*")
	if len(keys) != 1 {
		t.Errorf("list config_* = %d keys, want 1", len(keys))
	}

	// No match
	keys, _ = ms.List("xyz_*")
	if len(keys) != 0 {
		t.Errorf("list xyz_* = %d keys, want 0", len(keys))
	}
}

func TestListWithQuestionMark(t *testing.T) {
	path := tempStoragePath(t)
	ms, _ := NewMemoryStorage(path, 1024*1024, false, 3)

	ms.Set("a1", "v1")
	ms.Set("a2", "v2")
	ms.Set("ab", "v3")

	keys, _ := ms.List("a?")
	if len(keys) != 3 {
		t.Errorf("list a? = %d keys, want 3", len(keys))
	}
}

func TestMaxSizeEnforcement(t *testing.T) {
	path := tempStoragePath(t)
	// Very small max size
	ms, _ := NewMemoryStorage(path, 50, false, 3)

	// First small value should work
	err := ms.Set("k", "v")
	if err != nil {
		t.Fatalf("first set should succeed: %v", err)
	}

	// Large value should fail
	err = ms.Set("big", "this is a very long string that should exceed the 50 byte limit for testing purposes")
	if err == nil {
		t.Error("expected error for exceeding max size")
	}

	// Original key should still be there (rollback)
	_, found, _ := ms.Get("k")
	if !found {
		t.Error("original key should still exist after failed set")
	}
}

func TestPersistence(t *testing.T) {
	path := tempStoragePath(t)

	// Create and populate storage
	ms1, _ := NewMemoryStorage(path, 1024*1024, false, 3)
	ms1.Set("persistent_key", "persistent_value")

	// Create new storage instance from same file
	ms2, _ := NewMemoryStorage(path, 1024*1024, false, 3)
	val, found, _ := ms2.Get("persistent_key")
	if !found {
		t.Fatal("key should persist across instances")
	}
	if val != "persistent_value" {
		t.Errorf("value = %v, want 'persistent_value'", val)
	}
}

func TestBackup(t *testing.T) {
	path := tempStoragePath(t)

	ms, _ := NewMemoryStorage(path, 1024*1024, true, 3)
	ms.Set("key1", "value1")
	ms.Set("key2", "value2") // This triggers backup of previous state

	// Check backup file exists
	backupPath := path + ".bak.1"
	if _, err := os.Stat(backupPath); os.IsNotExist(err) {
		t.Error("backup file should exist")
	}
}

func TestEmptyKeyRejected(t *testing.T) {
	path := tempStoragePath(t)
	ms, _ := NewMemoryStorage(path, 1024*1024, false, 3)

	err := ms.Set("", "value")
	if err == nil {
		t.Error("expected error for empty key")
	}
}

func TestGlobMatch(t *testing.T) {
	tests := []struct {
		pattern string
		str     string
		match   bool
	}{
		{"*", "anything", true},
		{"*", "", true},
		{"hello", "hello", true},
		{"hello", "world", false},
		{"h*o", "hello", true},
		{"h*o", "ho", true},
		{"h?llo", "hello", true},
		{"h?llo", "hllo", false},
		{"user_*", "user_name", true},
		{"user_*", "config_name", false},
		{"*.json", "file.json", true},
		{"*.json", "file.txt", false},
	}

	for _, tt := range tests {
		got := matchGlob(tt.pattern, tt.str)
		if got != tt.match {
			t.Errorf("matchGlob(%q, %q) = %v, want %v", tt.pattern, tt.str, got, tt.match)
		}
	}
}
