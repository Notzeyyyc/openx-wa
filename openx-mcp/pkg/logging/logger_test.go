package logging

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestParseLevel(t *testing.T) {
	tests := []struct {
		input    string
		expected Level
	}{
		{"debug", LevelDebug},
		{"info", LevelInfo},
		{"warn", LevelWarn},
		{"warning", LevelWarn},
		{"error", LevelError},
		{"fatal", LevelFatal},
		{"unknown", LevelInfo}, // default
		{"", LevelInfo},        // default
	}

	for _, tt := range tests {
		got := ParseLevel(tt.input)
		if got != tt.expected {
			t.Errorf("ParseLevel(%q) = %v, want %v", tt.input, got, tt.expected)
		}
	}
}

func TestLevelString(t *testing.T) {
	tests := []struct {
		level    Level
		expected string
	}{
		{LevelDebug, "debug"},
		{LevelInfo, "info"},
		{LevelWarn, "warn"},
		{LevelError, "error"},
		{LevelFatal, "fatal"},
	}

	for _, tt := range tests {
		got := tt.level.String()
		if got != tt.expected {
			t.Errorf("Level(%d).String() = %q, want %q", tt.level, got, tt.expected)
		}
	}
}

func TestJSONEncoder(t *testing.T) {
	encoder := &JSONEncoder{}
	entry := &LogEntry{
		Timestamp: "2026-01-01T00:00:00Z",
		Level:     "info",
		Module:    "test",
		Message:   "hello world",
		Fields:    map[string]interface{}{"key": "value"},
	}

	data := encoder.Encode(entry)

	var decoded LogEntry
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal JSON log entry: %v", err)
	}

	if decoded.Message != "hello world" {
		t.Errorf("message = %q, want %q", decoded.Message, "hello world")
	}
	if decoded.Module != "test" {
		t.Errorf("module = %q, want %q", decoded.Module, "test")
	}
	if decoded.Level != "info" {
		t.Errorf("level = %q, want %q", decoded.Level, "info")
	}
}

func TestTextEncoder(t *testing.T) {
	encoder := &TextEncoder{}
	entry := &LogEntry{
		Timestamp: "2026-01-01T00:00:00Z",
		Level:     "info",
		Module:    "test",
		Message:   "hello world",
	}

	data := encoder.Encode(entry)
	output := string(data)

	if !strings.Contains(output, "INFO") {
		t.Errorf("text output should contain 'INFO', got: %s", output)
	}
	if !strings.Contains(output, "[test]") {
		t.Errorf("text output should contain '[test]', got: %s", output)
	}
	if !strings.Contains(output, "hello world") {
		t.Errorf("text output should contain 'hello world', got: %s", output)
	}
}

func TestLoggerLevelFiltering(t *testing.T) {
	var buf bytes.Buffer
	logger := &Logger{
		name:    "test",
		level:   LevelWarn,
		encoder: &JSONEncoder{},
		writer:  &buf,
	}

	// Debug and Info should be filtered out
	logger.Debug("debug message")
	logger.Info("info message")

	if buf.Len() > 0 {
		t.Errorf("expected no output for debug/info when level is warn, got: %s", buf.String())
	}

	// Warn and Error should pass through
	logger.Warn("warn message")
	if buf.Len() == 0 {
		t.Error("expected output for warn message")
	}

	buf.Reset()
	logger.Error("error message")
	if buf.Len() == 0 {
		t.Error("expected output for error message")
	}
}

func TestLoggerWithFields(t *testing.T) {
	var buf bytes.Buffer
	logger := &Logger{
		name:    "test",
		level:   LevelDebug,
		encoder: &JSONEncoder{},
		writer:  &buf,
	}

	logger.Info("test message", F("user", "alice"), F("count", 42))

	var entry LogEntry
	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if entry.Fields["user"] != "alice" {
		t.Errorf("field 'user' = %v, want 'alice'", entry.Fields["user"])
	}
	// JSON numbers are float64
	if entry.Fields["count"] != float64(42) {
		t.Errorf("field 'count' = %v, want 42", entry.Fields["count"])
	}
}

func TestLoggerWithModule(t *testing.T) {
	var buf bytes.Buffer
	logger := &Logger{
		name:    "parent",
		level:   LevelDebug,
		encoder: &JSONEncoder{},
		writer:  &buf,
	}

	child := logger.WithModule("child")
	child.Info("child message")

	var entry LogEntry
	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if entry.Module != "child" {
		t.Errorf("module = %q, want %q", entry.Module, "child")
	}
}
