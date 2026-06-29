// Package errors provides structured error handling for OpenX V2.
// It wraps errors with codes, context, and recovery suggestions.
package errors

import (
	"errors"
	"fmt"
)

// Common error codes used across OpenX V2.
const (
	ErrToolNotFound     = "ERR_TOOL_NOT_FOUND"
	ErrTimeout          = "ERR_TIMEOUT"
	ErrPermissionDenied = "ERR_PERMISSION_DENIED"
	ErrRateLimited      = "ERR_RATE_LIMITED"
	ErrInvalidInput     = "ERR_INVALID_INPUT"
	ErrIOFailure        = "ERR_IO_FAILURE"
	ErrNetworkFailure   = "ERR_NETWORK_FAILURE"
	ErrConfigInvalid    = "ERR_CONFIG_INVALID"
	ErrPluginInit       = "ERR_PLUGIN_INIT"
	ErrAuthFailed       = "ERR_AUTH_FAILED"
	ErrStorageFull      = "ERR_STORAGE_FULL"
	ErrKeyNotFound      = "ERR_KEY_NOT_FOUND"
	ErrInternal         = "ERR_INTERNAL"
)

// WrappedError is a structured error with code, context, and suggestion.
type WrappedError struct {
	Code       string
	Message    string
	Underlying error
	Context    map[string]interface{}
	Suggestion string
}

// Error implements the error interface.
func (e *WrappedError) Error() string {
	if e.Underlying != nil {
		return fmt.Sprintf("[%s] %s: %v", e.Code, e.Message, e.Underlying)
	}
	return fmt.Sprintf("[%s] %s", e.Code, e.Message)
}

// Unwrap returns the underlying error for errors.Is/As compatibility.
func (e *WrappedError) Unwrap() error {
	return e.Underlying
}

// New creates a new WrappedError without an underlying error.
func New(code, message string) *WrappedError {
	return &WrappedError{
		Code:    code,
		Message: message,
		Context: make(map[string]interface{}),
	}
}

// Wrap wraps an existing error with a code and message.
func Wrap(err error, code, message string) *WrappedError {
	return &WrappedError{
		Code:       code,
		Message:    message,
		Underlying: err,
		Context:    make(map[string]interface{}),
	}
}

// WrapWithContext wraps an error with code, message, and context fields.
func WrapWithContext(err error, code, message string, ctx map[string]interface{}) *WrappedError {
	return &WrappedError{
		Code:       code,
		Message:    message,
		Underlying: err,
		Context:    ctx,
	}
}

// WithSuggestion adds a recovery suggestion to the error.
func (e *WrappedError) WithSuggestion(suggestion string) *WrappedError {
	e.Suggestion = suggestion
	return e
}

// WithContext adds a context field to the error.
func (e *WrappedError) WithContext(key string, value interface{}) *WrappedError {
	if e.Context == nil {
		e.Context = make(map[string]interface{})
	}
	e.Context[key] = value
	return e
}

// Is checks if the target error has the same code.
func Is(err error, code string) bool {
	var we *WrappedError
	if errors.As(err, &we) {
		return we.Code == code
	}
	return false
}

// GetCode extracts the error code from a WrappedError, or returns ErrInternal.
func GetCode(err error) string {
	var we *WrappedError
	if errors.As(err, &we) {
		return we.Code
	}
	return ErrInternal
}

// GetSuggestion extracts the suggestion from a WrappedError.
func GetSuggestion(err error) string {
	var we *WrappedError
	if errors.As(err, &we) {
		return we.Suggestion
	}
	return ""
}
