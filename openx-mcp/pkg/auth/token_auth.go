package auth

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"sync"

	"github.com/notzeyyc/openx-v2/config"
	"github.com/notzeyyc/openx-v2/pkg/logging"
)

// TokenAuth implements token-based authentication and authorization.
type TokenAuth struct {
	mu              sync.RWMutex
	tokens          map[string]*tokenInfo // hash -> info
	toolPermissions map[string]string     // tool_name -> required permission
	logger          *logging.Logger
}

// tokenInfo holds metadata about a registered token.
type tokenInfo struct {
	Name               string
	Hash               string
	Permissions        []string
	RateLimitPerMinute int
}

// NewTokenAuth creates a new TokenAuth from configuration.
func NewTokenAuth(cfg *config.SecurityConfig) *TokenAuth {
	ta := &TokenAuth{
		tokens:          make(map[string]*tokenInfo),
		toolPermissions: make(map[string]string),
		logger:          logging.GetLogger("auth"),
	}

	// Register tokens
	for _, tokenCfg := range cfg.Tokens {
		hash := hashToken(tokenCfg.Token)
		ta.tokens[hash] = &tokenInfo{
			Name:               tokenCfg.Name,
			Hash:               hash,
			Permissions:        tokenCfg.Permissions,
			RateLimitPerMinute: tokenCfg.RateLimitPerMinute,
		}
	}

	// Register tool permissions
	for tool, perm := range cfg.ToolPermissions {
		ta.toolPermissions[tool] = perm
	}

	ta.logger.Infof("initialized token auth with %d tokens and %d tool permissions",
		len(ta.tokens), len(ta.toolPermissions))

	return ta
}

// VerifyToken validates a token and returns the associated principal.
// Uses constant-time comparison to prevent timing attacks.
func (ta *TokenAuth) VerifyToken(token string) (*Principal, error) {
	if token == "" {
		return nil, ErrInvalidToken
	}

	hash := hashToken(token)

	ta.mu.RLock()
	defer ta.mu.RUnlock()

	// Iterate all tokens with constant-time comparison
	for storedHash, info := range ta.tokens {
		if constantTimeEqual(hash, storedHash) {
			return &Principal{
				Name:               info.Name,
				Permissions:        info.Permissions,
				RateLimitPerMinute: info.RateLimitPerMinute,
			}, nil
		}
	}

	ta.logger.Warnf("invalid token attempt (hash prefix: %s...)", hash[:8])
	return nil, ErrInvalidToken
}

// Authorize checks if a principal has permission to call a specific tool.
func (ta *TokenAuth) Authorize(principal *Principal, toolName string) error {
	if principal == nil {
		return ErrPermissionDenied
	}

	requiredPerm := ta.GetToolPermission(toolName)

	if !principal.HasPermission(requiredPerm) {
		ta.logger.Warnf("permission denied: %s tried to call %s (requires %s)",
			principal.Name, toolName, requiredPerm)
		return &AuthError{
			Code:    "AUTH_PERMISSION_DENIED",
			Message: fmt.Sprintf("tool %q requires %q permission", toolName, requiredPerm),
		}
	}

	return nil
}

// GetToolPermission returns the required permission level for a tool.
// Defaults to "execute" if not explicitly configured.
func (ta *TokenAuth) GetToolPermission(toolName string) string {
	ta.mu.RLock()
	defer ta.mu.RUnlock()

	if perm, exists := ta.toolPermissions[toolName]; exists {
		return perm
	}

	// Default: require execute permission for unknown tools
	return PermExecute
}

// AddToken registers a new token at runtime.
func (ta *TokenAuth) AddToken(name, token string, permissions []string, rateLimit int) {
	hash := hashToken(token)

	ta.mu.Lock()
	defer ta.mu.Unlock()

	ta.tokens[hash] = &tokenInfo{
		Name:               name,
		Hash:               hash,
		Permissions:        permissions,
		RateLimitPerMinute: rateLimit,
	}
}

// RemoveToken removes a token by name.
func (ta *TokenAuth) RemoveToken(name string) bool {
	ta.mu.Lock()
	defer ta.mu.Unlock()

	for hash, info := range ta.tokens {
		if info.Name == name {
			delete(ta.tokens, hash)
			return true
		}
	}
	return false
}

// hashToken creates a SHA-256 hash of the token.
func hashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

// constantTimeEqual performs constant-time string comparison.
func constantTimeEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
