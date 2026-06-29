package errors

import (
	"fmt"
	"testing"
)

func TestNew(t *testing.T) {
	err := New(ErrToolNotFound, "tool xyz not found")

	if err.Code != ErrToolNotFound {
		t.Errorf("code = %q, want %q", err.Code, ErrToolNotFound)
	}
	if err.Message != "tool xyz not found" {
		t.Errorf("message = %q, want %q", err.Message, "tool xyz not found")
	}
	if err.Underlying != nil {
		t.Errorf("underlying should be nil")
	}
}

func TestWrap(t *testing.T) {
	original := fmt.Errorf("connection refused")
	wrapped := Wrap(original, ErrNetworkFailure, "failed to fetch URL")

	if wrapped.Code != ErrNetworkFailure {
		t.Errorf("code = %q, want %q", wrapped.Code, ErrNetworkFailure)
	}
	if wrapped.Underlying != original {
		t.Errorf("underlying should be the original error")
	}

	// Test Error() output
	errStr := wrapped.Error()
	if errStr == "" {
		t.Error("Error() should not be empty")
	}
}

func TestWrapWithContext(t *testing.T) {
	original := fmt.Errorf("disk full")
	ctx := map[string]interface{}{
		"path": "/data/local/tmp/memory.json",
		"size": 10485760,
	}
	wrapped := WrapWithContext(original, ErrIOFailure, "failed to persist memory", ctx)

	if wrapped.Context["path"] != "/data/local/tmp/memory.json" {
		t.Errorf("context path = %v, want '/data/local/tmp/memory.json'", wrapped.Context["path"])
	}
	if wrapped.Context["size"] != 10485760 {
		t.Errorf("context size = %v, want 10485760", wrapped.Context["size"])
	}
}

func TestWithSuggestion(t *testing.T) {
	err := New(ErrStorageFull, "memory storage full").
		WithSuggestion("increase max_size_bytes in config.yaml or delete unused keys")

	if err.Suggestion == "" {
		t.Error("suggestion should not be empty")
	}
}

func TestWithContext(t *testing.T) {
	err := New(ErrKeyNotFound, "key not found").
		WithContext("key", "user_name").
		WithContext("operation", "get")

	if err.Context["key"] != "user_name" {
		t.Errorf("context key = %v, want 'user_name'", err.Context["key"])
	}
	if err.Context["operation"] != "get" {
		t.Errorf("context operation = %v, want 'get'", err.Context["operation"])
	}
}

func TestIs(t *testing.T) {
	err := New(ErrTimeout, "operation timed out")

	if !Is(err, ErrTimeout) {
		t.Error("Is should return true for matching code")
	}
	if Is(err, ErrPermissionDenied) {
		t.Error("Is should return false for non-matching code")
	}
}

func TestGetCode(t *testing.T) {
	err := New(ErrRateLimited, "too many requests")
	if GetCode(err) != ErrRateLimited {
		t.Errorf("GetCode = %q, want %q", GetCode(err), ErrRateLimited)
	}

	// Non-wrapped error should return ErrInternal
	plainErr := fmt.Errorf("plain error")
	if GetCode(plainErr) != ErrInternal {
		t.Errorf("GetCode for plain error = %q, want %q", GetCode(plainErr), ErrInternal)
	}
}

func TestUnwrap(t *testing.T) {
	original := fmt.Errorf("original error")
	wrapped := Wrap(original, ErrInternal, "wrapped")

	unwrapped := wrapped.Unwrap()
	if unwrapped != original {
		t.Error("Unwrap should return the original error")
	}
}
