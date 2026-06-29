package auth

import (
	"github.com/notzeyyc/openx-v2/config"
	"github.com/notzeyyc/openx-v2/pkg/logging"
)

// Middleware provides authentication and rate limiting for tool calls.
type Middleware struct {
	enabled     bool
	authorizer  *TokenAuth
	rateLimiter *RateLimiter
	logger      *logging.Logger
}

// NewMiddleware creates a new auth middleware from configuration.
func NewMiddleware(cfg *config.SecurityConfig) *Middleware {
	m := &Middleware{
		enabled: cfg.Enabled,
		logger:  logging.GetLogger("auth_middleware"),
	}

	if !cfg.Enabled {
		m.logger.Info("auth middleware disabled")
		return m
	}

	m.authorizer = NewTokenAuth(cfg)
	m.rateLimiter = NewRateLimiter(cfg.RateLimit)

	m.logger.Info("auth middleware enabled")
	return m
}

// CheckAccess verifies that a token has permission to call a tool and is not rate limited.
// Returns nil if access is granted, or an error describing why access was denied.
func (m *Middleware) CheckAccess(token, toolName string) error {
	if !m.enabled {
		return nil
	}

	// Verify token
	principal, err := m.authorizer.VerifyToken(token)
	if err != nil {
		return err
	}

	// Check authorization
	if err := m.authorizer.Authorize(principal, toolName); err != nil {
		return err
	}

	// Check rate limit
	if !m.rateLimiter.Allow(principal.Name, principal.RateLimitPerMinute) {
		m.logger.Warnf("rate limited: %s calling %s", principal.Name, toolName)
		return ErrRateLimited
	}

	return nil
}

// IsEnabled returns whether auth is enabled.
func (m *Middleware) IsEnabled() bool {
	return m.enabled
}

// Close cleans up middleware resources.
func (m *Middleware) Close() {
	if m.rateLimiter != nil {
		m.rateLimiter.Close()
	}
}
