package logging

import (
	"encoding/json"
	"fmt"
	"strings"
)

// LogEntry represents a single structured log entry.
type LogEntry struct {
	Timestamp string                 `json:"timestamp"`
	Level     string                 `json:"level"`
	Module    string                 `json:"module"`
	Message   string                 `json:"message"`
	Fields    map[string]interface{} `json:"fields,omitempty"`
	Error     string                 `json:"error,omitempty"`
}

// Encoder defines the interface for log entry encoding.
type Encoder interface {
	Encode(entry *LogEntry) []byte
}

// JSONEncoder encodes log entries as JSON (one per line).
type JSONEncoder struct{}

// Encode serializes a LogEntry to JSON with a trailing newline.
func (e *JSONEncoder) Encode(entry *LogEntry) []byte {
	data, err := json.Marshal(entry)
	if err != nil {
		// Fallback to a simple error message if marshaling fails
		return []byte(fmt.Sprintf(`{"error":"marshal failed: %v","message":"%s"}`, err, entry.Message) + "\n")
	}
	return append(data, '\n')
}

// TextEncoder encodes log entries as human-readable text.
type TextEncoder struct{}

// Encode serializes a LogEntry to a human-readable text format.
func (e *TextEncoder) Encode(entry *LogEntry) []byte {
	var sb strings.Builder

	// Format: [TIMESTAMP] LEVEL [MODULE] Message key=value ...
	sb.WriteString(fmt.Sprintf("[%s] %s", entry.Timestamp, strings.ToUpper(entry.Level)))

	if entry.Module != "" {
		sb.WriteString(fmt.Sprintf(" [%s]", entry.Module))
	}

	sb.WriteString(" ")
	sb.WriteString(entry.Message)

	if entry.Error != "" {
		sb.WriteString(fmt.Sprintf(" error=%s", entry.Error))
	}

	for k, v := range entry.Fields {
		sb.WriteString(fmt.Sprintf(" %s=%v", k, v))
	}

	sb.WriteString("\n")
	return []byte(sb.String())
}
