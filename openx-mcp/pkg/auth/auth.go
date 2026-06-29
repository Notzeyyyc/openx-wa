// Package auth provides authentication, authorization, and rate limiting
// for OpenX V2. It supports token-based auth with per-tool permissions
// and token bucket rate limiting.
package auth

import (
	"fmt"
)

// Permission levels for tool access control.
const (
	PermRead    = "read"
	PermExecute = "execute"
	PermAdmin   = "admin"
)

// Principal represents an authenticated entity (user/client).
type Principal struct {
	Name               string
	Permissions        []string
	RateLimitPerMinute int
}

// HasPermission checks if the principal has the required permission level.
// Admin permission grants access to everything.
func (p *Principal) HasPermission(required string) bool {
	for _, perm := range p.Permissions {
		if perm == PermAdmin || perm == required {
			return true
		}
		// Execute implies read
		if perm == PermExecute && required == PermRead {
			return true
		}
	}
	return false
}

// Authorizer defines the interface for authentication and authorization.
type Authorizer interface {
	// VerifyToken validates a token and returns the associated principal.
	VerifyToken(token string) (*Principal, error)

	// Authorize checks if a principal has permission to call a specific tool.
	Authorize(principal *Principal, toolName string) error

	// GetToolPermission returns the required permission level for a tool.
	GetToolPermission(toolName string) string
}

// AuthError represents an authentication/authorization error.
type AuthError struct {
	Code    string
	Message string
}

func (e *AuthError) Error() string {
	return fmt.Sprintf("[%s] %s", e.Code, e.Message)
}

// Common auth errors
var (
	ErrInvalidToken    = &AuthError{Code: "AUTH_INVALID_TOKEN", Message: "invalid or expired token"}
	ErrPermissionDenied = &AuthError{Code: "AUTH_PERMISSION_DENIED", Message: "insufficient permissions"}
	ErrRateLimited     = &AuthError{Code: "AUTH_RATE_LIMITED", Message: "rate limit exceeded"}
	ErrAuthDisabled    = &AuthError{Code: "AUTH_DISABLED", Message: "authentication is disabled"}
)
