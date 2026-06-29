package logging

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// FileWriter implements io.Writer with log rotation by size.
// It rotates log files when they exceed maxSize bytes and keeps
// up to maxBackups rotated files. Thread-safe via mutex.
type FileWriter struct {
	mu         sync.Mutex
	file       *os.File
	filePath   string
	maxSize    int64
	maxBackups int
	currentSize int64
}

// NewFileWriter creates a new FileWriter that rotates at maxSize bytes.
func NewFileWriter(filePath string, maxSize int64, maxBackups int) (*FileWriter, error) {
	// Ensure directory exists
	dir := filepath.Dir(filePath)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, fmt.Errorf("create log directory: %w", err)
		}
	}

	f, err := os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return nil, fmt.Errorf("open log file: %w", err)
	}

	// Get current file size
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, fmt.Errorf("stat log file: %w", err)
	}

	return &FileWriter{
		file:        f,
		filePath:    filePath,
		maxSize:     maxSize,
		maxBackups:  maxBackups,
		currentSize: info.Size(),
	}, nil
}

// Write implements io.Writer. It writes data to the log file and rotates
// if the file exceeds maxSize.
func (fw *FileWriter) Write(p []byte) (int, error) {
	fw.mu.Lock()
	defer fw.mu.Unlock()

	// Check if rotation is needed
	if fw.currentSize+int64(len(p)) > fw.maxSize {
		if err := fw.rotate(); err != nil {
			// If rotation fails, still try to write
			_ = err
		}
	}

	n, err := fw.file.Write(p)
	fw.currentSize += int64(n)
	return n, err
}

// rotate closes the current file, renames it with a numeric suffix,
// removes old backups, and opens a new file.
func (fw *FileWriter) rotate() error {
	// Close current file
	if err := fw.file.Close(); err != nil {
		return fmt.Errorf("close current log file: %w", err)
	}

	// Shift existing backups: .4 -> .5, .3 -> .4, etc.
	// Remove oldest if exceeds maxBackups
	for i := fw.maxBackups; i >= 1; i-- {
		src := fmt.Sprintf("%s.%d", fw.filePath, i-1)
		dst := fmt.Sprintf("%s.%d", fw.filePath, i)

		if i == fw.maxBackups {
			// Remove the oldest backup
			os.Remove(dst)
		}

		if _, err := os.Stat(src); err == nil {
			os.Rename(src, dst)
		}
	}

	// Rename current file to .1
	backupPath := fmt.Sprintf("%s.%d", fw.filePath, 1)
	if err := os.Rename(fw.filePath, backupPath); err != nil {
		// If rename fails, try to reopen the original file
		f, openErr := os.OpenFile(fw.filePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
		if openErr != nil {
			return fmt.Errorf("rename failed (%v) and reopen failed: %w", err, openErr)
		}
		fw.file = f
		return fmt.Errorf("rename log file: %w", err)
	}

	// Open new file
	f, err := os.OpenFile(fw.filePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return fmt.Errorf("open new log file: %w", err)
	}

	fw.file = f
	fw.currentSize = 0
	return nil
}

// Close closes the underlying file.
func (fw *FileWriter) Close() error {
	fw.mu.Lock()
	defer fw.mu.Unlock()

	if fw.file != nil {
		return fw.file.Close()
	}
	return nil
}
