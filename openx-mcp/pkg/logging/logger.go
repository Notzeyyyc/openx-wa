// Package logging provides structured logging for OpenX V2.
// It supports JSON and text output formats, log levels, module-scoped loggers,
// and file rotation to prevent disk exhaustion on resource-constrained devices.
package logging

import (
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"
)

// Level represents log severity levels.
type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
	LevelFatal
)

// String returns the string representation of a log level.
func (l Level) String() string {
	switch l {
	case LevelDebug:
		return "debug"
	case LevelInfo:
		return "info"
	case LevelWarn:
		return "warn"
	case LevelError:
		return "error"
	case LevelFatal:
		return "fatal"
	default:
		return "unknown"
	}
}

// ParseLevel converts a string to a Level.
func ParseLevel(s string) Level {
	switch strings.ToLower(s) {
	case "debug":
		return LevelDebug
	case "info":
		return LevelInfo
	case "warn", "warning":
		return LevelWarn
	case "error":
		return LevelError
	case "fatal":
		return LevelFatal
	default:
		return LevelInfo
	}
}

// Logger provides structured logging with module scoping.
type Logger struct {
	mu      sync.Mutex
	name    string
	level   Level
	encoder Encoder
	writer  io.Writer
}

// LoggerConfig holds configuration for creating a new logger.
type LoggerConfig struct {
	Level   string
	Format  string // "json" or "text"
	Output  string // "stdout", "stderr", or file path
	File    string
	Module  string
	MaxSize int64 // max file size in bytes before rotation
}

// global logger instance
var (
	globalLogger *Logger
	globalMu     sync.RWMutex
)

// Init initializes the global logger with the given configuration.
func Init(cfg LoggerConfig) error {
	logger, err := NewLogger(cfg)
	if err != nil {
		return err
	}

	globalMu.Lock()
	globalLogger = logger
	globalMu.Unlock()

	return nil
}

// GetLogger returns a module-scoped logger derived from the global logger.
func GetLogger(module string) *Logger {
	globalMu.RLock()
	defer globalMu.RUnlock()

	if globalLogger == nil {
		// Return a default stderr logger if not initialized
		return &Logger{
			name:    module,
			level:   LevelInfo,
			encoder: &TextEncoder{},
			writer:  os.Stderr,
		}
	}

	return &Logger{
		name:    module,
		level:   globalLogger.level,
		encoder: globalLogger.encoder,
		writer:  globalLogger.writer,
	}
}

// NewLogger creates a new Logger instance.
func NewLogger(cfg LoggerConfig) (*Logger, error) {
	level := ParseLevel(cfg.Level)

	var encoder Encoder
	switch strings.ToLower(cfg.Format) {
	case "json":
		encoder = &JSONEncoder{}
	default:
		encoder = &TextEncoder{}
	}

	var writer io.Writer
	switch strings.ToLower(cfg.Output) {
	case "stdout":
		writer = os.Stdout
	case "stderr", "":
		writer = os.Stderr
	case "file":
		if cfg.File == "" {
			return nil, fmt.Errorf("file path required when output is 'file'")
		}
		maxSize := cfg.MaxSize
		if maxSize == 0 {
			maxSize = 10 * 1024 * 1024 // 10MB default
		}
		fw, err := NewFileWriter(cfg.File, maxSize, 5)
		if err != nil {
			return nil, fmt.Errorf("create file writer: %w", err)
		}
		writer = fw
	default:
		writer = os.Stderr
	}

	return &Logger{
		name:    cfg.Module,
		level:   level,
		encoder: encoder,
		writer:  writer,
	}, nil
}

// WithModule returns a new logger scoped to the given module name.
func (l *Logger) WithModule(module string) *Logger {
	return &Logger{
		name:    module,
		level:   l.level,
		encoder: l.encoder,
		writer:  l.writer,
	}
}

// Debug logs a message at debug level.
func (l *Logger) Debug(msg string, fields ...Field) {
	l.log(LevelDebug, msg, fields...)
}

// Info logs a message at info level.
func (l *Logger) Info(msg string, fields ...Field) {
	l.log(LevelInfo, msg, fields...)
}

// Warn logs a message at warn level.
func (l *Logger) Warn(msg string, fields ...Field) {
	l.log(LevelWarn, msg, fields...)
}

// Error logs a message at error level.
func (l *Logger) Error(msg string, fields ...Field) {
	l.log(LevelError, msg, fields...)
}

// Fatal logs a message at fatal level and exits.
func (l *Logger) Fatal(msg string, fields ...Field) {
	l.log(LevelFatal, msg, fields...)
	os.Exit(1)
}

// Debugf logs a formatted message at debug level.
func (l *Logger) Debugf(format string, args ...interface{}) {
	l.log(LevelDebug, fmt.Sprintf(format, args...))
}

// Infof logs a formatted message at info level.
func (l *Logger) Infof(format string, args ...interface{}) {
	l.log(LevelInfo, fmt.Sprintf(format, args...))
}

// Warnf logs a formatted message at warn level.
func (l *Logger) Warnf(format string, args ...interface{}) {
	l.log(LevelWarn, fmt.Sprintf(format, args...))
}

// Errorf logs a formatted message at error level.
func (l *Logger) Errorf(format string, args ...interface{}) {
	l.log(LevelError, fmt.Sprintf(format, args...))
}

// Fatalf logs a formatted message at fatal level and exits.
func (l *Logger) Fatalf(format string, args ...interface{}) {
	l.log(LevelFatal, fmt.Sprintf(format, args...))
	os.Exit(1)
}

func (l *Logger) log(level Level, msg string, fields ...Field) {
	if level < l.level {
		return
	}

	entry := &LogEntry{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Level:     level.String(),
		Module:    l.name,
		Message:   msg,
		Fields:    make(map[string]interface{}),
	}

	for _, f := range fields {
		entry.Fields[f.Key] = f.Value
	}

	data := l.encoder.Encode(entry)

	l.mu.Lock()
	l.writer.Write(data)
	l.mu.Unlock()
}

// Field represents a key-value pair for structured logging.
type Field struct {
	Key   string
	Value interface{}
}

// F creates a new Field.
func F(key string, value interface{}) Field {
	return Field{Key: key, Value: value}
}

// Close closes the logger's writer if it implements io.Closer.
func (l *Logger) Close() error {
	if closer, ok := l.writer.(io.Closer); ok {
		return closer.Close()
	}
	return nil
}
