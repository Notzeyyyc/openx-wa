// Package memory provides persistent key-value storage for OpenX V2.
// It uses a JSON file as the backing store with atomic writes, file locking,
// and backup support to prevent data corruption on crash.
package memory

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/notzeyyc/openx-v2/pkg/logging"
)

// MemoryStorage provides thread-safe persistent key-value storage.
type MemoryStorage struct {
	mu           sync.RWMutex
	filePath     string
	data         map[string]interface{}
	maxSizeBytes int64
	autoBackup   bool
	backupCount  int
	logger       *logging.Logger
}

// NewMemoryStorage creates a new MemoryStorage instance.
// It loads existing data from the file if it exists.
func NewMemoryStorage(filePath string, maxSizeBytes int64, autoBackup bool, backupCount int) (*MemoryStorage, error) {
	ms := &MemoryStorage{
		filePath:     filePath,
		data:         make(map[string]interface{}),
		maxSizeBytes: maxSizeBytes,
		autoBackup:   autoBackup,
		backupCount:  backupCount,
		logger:       logging.GetLogger("memory"),
	}

	// Ensure directory exists
	dir := filepath.Dir(filePath)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, fmt.Errorf("create memory storage directory: %w", err)
		}
	}

	// Load existing data
	if err := ms.loadFromFile(); err != nil {
		ms.logger.Warnf("failed to load memory file, starting fresh: %v", err)
		ms.data = make(map[string]interface{})
	}

	return ms, nil
}

// Set stores a value for the given key. Returns error if storage is full.
func (ms *MemoryStorage) Set(key string, value interface{}) error {
	if key == "" {
		return fmt.Errorf("key cannot be empty")
	}

	ms.mu.Lock()
	defer ms.mu.Unlock()

	// Store the value
	ms.data[key] = value

	return ms.persist()
}

// Get retrieves the value for the given key.
func (ms *MemoryStorage) Get(key string) (interface{}, bool, error) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	val, exists := ms.data[key]
	return val, exists, nil
}

// List returns all keys matching the given glob pattern.
// Supports * (any characters) and ? (single character).
func (ms *MemoryStorage) List(pattern string) ([]string, error) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	if pattern == "" {
		pattern = "*"
	}

	var matches []string
	for key := range ms.data {
		if matchGlob(pattern, key) {
			matches = append(matches, key)
		}
	}

	return matches, nil
}

// Delete removes a key from storage.
func (ms *MemoryStorage) Delete(key string) (bool, error) {
	ms.mu.Lock()
	defer ms.mu.Unlock()

	_, exists := ms.data[key]
	if !exists {
		return false, nil
	}

	delete(ms.data, key)
	return true, ms.persist()
}

// Clear removes all data from storage.
func (ms *MemoryStorage) Clear() error {
	ms.mu.Lock()
	defer ms.mu.Unlock()

	ms.data = make(map[string]interface{})
	return ms.persist()
}

// Count returns the number of stored keys.
func (ms *MemoryStorage) Count() int {
	ms.mu.RLock()
	defer ms.mu.RUnlock()
	return len(ms.data)
}

// persist marshals data once, checks size, and writes atomically (temp file + rename).
func (ms *MemoryStorage) persist() error {
	data, err := json.MarshalIndent(ms.data, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal memory data: %w", err)
	}

	// Check size on already-marshaled data
	if ms.maxSizeBytes > 0 && int64(len(data)) > ms.maxSizeBytes {
		return fmt.Errorf("storage size (%d bytes) exceeds maximum (%d bytes)", len(data), ms.maxSizeBytes)
	}

	// Create backup before writing (if enabled)
	if ms.autoBackup {
		ms.createBackup()
	}

	// Atomic write: write to temp file, then rename
	tmpPath := ms.filePath + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0600); err != nil {
		return fmt.Errorf("write temp file: %w", err)
	}

	if err := os.Rename(tmpPath, ms.filePath); err != nil {
		// Try direct write as fallback
		os.Remove(tmpPath)
		if err := os.WriteFile(ms.filePath, data, 0600); err != nil {
			return fmt.Errorf("write memory file: %w", err)
		}
	}

	return nil
}

// loadFromFile reads existing data from the storage file.
func (ms *MemoryStorage) loadFromFile() error {
	data, err := os.ReadFile(ms.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // No file yet, start fresh
		}
		// Try loading from backup
		return ms.loadFromBackup()
	}

	if len(data) == 0 {
		return nil
	}

	if err := json.Unmarshal(data, &ms.data); err != nil {
		ms.logger.Warnf("corrupted memory file, trying backup: %v", err)
		return ms.loadFromBackup()
	}

	return nil
}

// loadFromBackup attempts to load data from the most recent backup.
func (ms *MemoryStorage) loadFromBackup() error {
	for i := 1; i <= ms.backupCount; i++ {
		backupPath := fmt.Sprintf("%s.bak.%d", ms.filePath, i)
		data, err := os.ReadFile(backupPath)
		if err != nil {
			continue
		}

		if err := json.Unmarshal(data, &ms.data); err != nil {
			continue
		}

		ms.logger.Infof("recovered from backup: %s", backupPath)
		return nil
	}

	return fmt.Errorf("no valid backup found")
}

// createBackup creates a backup of the current file.
func (ms *MemoryStorage) createBackup() {
	// Shift existing backups: .bak.2 -> .bak.3, .bak.1 -> .bak.2
	for i := ms.backupCount; i >= 2; i-- {
		src := fmt.Sprintf("%s.bak.%d", ms.filePath, i-1)
		dst := fmt.Sprintf("%s.bak.%d", ms.filePath, i)
		os.Rename(src, dst)
	}

	// Copy current file to .bak.1
	if data, err := os.ReadFile(ms.filePath); err == nil {
		backupPath := fmt.Sprintf("%s.bak.%d", ms.filePath, 1)
		os.WriteFile(backupPath, data, 0600)
	}
}

// Close performs any cleanup needed (currently a no-op but satisfies interface).
func (ms *MemoryStorage) Close() error {
	// Ensure final persist
	ms.mu.Lock()
	defer ms.mu.Unlock()
	return ms.persist()
}

// matchGlob performs simple glob pattern matching supporting * and ?.
func matchGlob(pattern, str string) bool {
	if pattern == "*" {
		return true
	}

	// Convert glob to a simple matching algorithm
	return globMatch(pattern, str)
}

// globMatch implements glob matching with * and ? wildcards.
func globMatch(pattern, str string) bool {
	for len(pattern) > 0 {
		switch pattern[0] {
		case '*':
			// Skip consecutive stars
			for len(pattern) > 0 && pattern[0] == '*' {
				pattern = pattern[1:]
			}
			if len(pattern) == 0 {
				return true
			}
			// Try matching the rest of the pattern at each position
			for i := 0; i <= len(str); i++ {
				if globMatch(pattern, str[i:]) {
					return true
				}
			}
			return false
		case '?':
			if len(str) == 0 {
				return false
			}
			pattern = pattern[1:]
			str = str[1:]
		default:
			if len(str) == 0 || pattern[0] != str[0] {
				return false
			}
			pattern = pattern[1:]
			str = str[1:]
		}
	}

	return len(str) == 0
}

// HasPrefix checks if any keys start with the given prefix.
func (ms *MemoryStorage) HasPrefix(prefix string) bool {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	for key := range ms.data {
		if strings.HasPrefix(key, prefix) {
			return true
		}
	}
	return false
}
