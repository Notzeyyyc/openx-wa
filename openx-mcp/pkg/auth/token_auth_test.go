package auth

import (
	"testing"

	"github.com/notzeyyc/openx-v2/config"
	"github.com/notzeyyc/openx-v2/pkg/logging"
)

func init() {
	logging.Init(logging.LoggerConfig{
		Level:  "error",
		Format: "text",
		Output: "stderr",
	})
}

func testSecurityConfig() *config.SecurityConfig {
	return &config.SecurityConfig{
		Enabled:  true,
		AuthMode: "token",
		Tokens: []config.TokenConfig{
			{
				Name:               "admin_user",
				Token:              "sk_openx_admin_secret",
				Permissions:        []string{"admin"},
				RateLimitPerMinute: 120,
			},
			{
				Name:               "read_user",
				Token:              "sk_openx_read_only",
				Permissions:        []string{"read"},
				RateLimitPerMinute: 30,
			},
			{
				Name:               "exec_user",
				Token:              "sk_openx_executor",
				Permissions:        []string{"read", "execute"},
				RateLimitPerMinute: 60,
			},
		},
		ToolPermissions: map[string]string{
			"shell_exec":     "execute",
			"file_read":      "read",
			"file_write":     "execute",
			"memory_clear":   "admin",
			"battery_status": "read",
		},
		RateLimit: config.RateLimitConfig{
			Enabled:       true,
			WindowSeconds: 60,
			BurstSize:     10,
		},
	}
}

func TestVerifyTokenValid(t *testing.T) {
	ta := NewTokenAuth(testSecurityConfig())

	principal, err := ta.VerifyToken("sk_openx_admin_secret")
	if err != nil {
		t.Fatalf("VerifyToken failed: %v", err)
	}
	if principal.Name != "admin_user" {
		t.Errorf("name = %q, want 'admin_user'", principal.Name)
	}
}

func TestVerifyTokenInvalid(t *testing.T) {
	ta := NewTokenAuth(testSecurityConfig())

	_, err := ta.VerifyToken("invalid_token")
	if err == nil {
		t.Error("expected error for invalid token")
	}
}

func TestVerifyTokenEmpty(t *testing.T) {
	ta := NewTokenAuth(testSecurityConfig())

	_, err := ta.VerifyToken("")
	if err == nil {
		t.Error("expected error for empty token")
	}
}

func TestAuthorizeAdminAccess(t *testing.T) {
	ta := NewTokenAuth(testSecurityConfig())

	principal := &Principal{
		Name:        "admin_user",
		Permissions: []string{"admin"},
	}

	// Admin should access everything
	tools := []string{"shell_exec", "file_read", "file_write", "memory_clear", "battery_status"}
	for _, tool := range tools {
		if err := ta.Authorize(principal, tool); err != nil {
			t.Errorf("admin should have access to %s: %v", tool, err)
		}
	}
}

func TestAuthorizeReadOnlyAccess(t *testing.T) {
	ta := NewTokenAuth(testSecurityConfig())

	principal := &Principal{
		Name:        "read_user",
		Permissions: []string{"read"},
	}

	// Read user should access read tools
	if err := ta.Authorize(principal, "file_read"); err != nil {
		t.Errorf("read user should access file_read: %v", err)
	}
	if err := ta.Authorize(principal, "battery_status"); err != nil {
		t.Errorf("read user should access battery_status: %v", err)
	}

	// Read user should NOT access execute tools
	if err := ta.Authorize(principal, "shell_exec"); err == nil {
		t.Error("read user should NOT access shell_exec")
	}

	// Read user should NOT access admin tools
	if err := ta.Authorize(principal, "memory_clear"); err == nil {
		t.Error("read user should NOT access memory_clear")
	}
}

func TestAuthorizeExecuteAccess(t *testing.T) {
	ta := NewTokenAuth(testSecurityConfig())

	principal := &Principal{
		Name:        "exec_user",
		Permissions: []string{"read", "execute"},
	}

	// Execute user should access read and execute tools
	if err := ta.Authorize(principal, "file_read"); err != nil {
		t.Errorf("exec user should access file_read: %v", err)
	}
	if err := ta.Authorize(principal, "shell_exec"); err != nil {
		t.Errorf("exec user should access shell_exec: %v", err)
	}

	// Execute user should NOT access admin tools
	if err := ta.Authorize(principal, "memory_clear"); err == nil {
		t.Error("exec user should NOT access memory_clear")
	}
}

func TestGetToolPermission(t *testing.T) {
	ta := NewTokenAuth(testSecurityConfig())

	if perm := ta.GetToolPermission("shell_exec"); perm != "execute" {
		t.Errorf("shell_exec permission = %q, want 'execute'", perm)
	}
	if perm := ta.GetToolPermission("file_read"); perm != "read" {
		t.Errorf("file_read permission = %q, want 'read'", perm)
	}
	// Unknown tool defaults to execute
	if perm := ta.GetToolPermission("unknown_tool"); perm != "execute" {
		t.Errorf("unknown_tool permission = %q, want 'execute'", perm)
	}
}

func TestPrincipalHasPermission(t *testing.T) {
	tests := []struct {
		permissions []string
		required    string
		expected    bool
	}{
		{[]string{"admin"}, "read", true},
		{[]string{"admin"}, "execute", true},
		{[]string{"admin"}, "admin", true},
		{[]string{"read"}, "read", true},
		{[]string{"read"}, "execute", false},
		{[]string{"execute"}, "read", true},  // execute implies read
		{[]string{"execute"}, "execute", true},
		{[]string{"execute"}, "admin", false},
	}

	for _, tt := range tests {
		p := &Principal{Permissions: tt.permissions}
		got := p.HasPermission(tt.required)
		if got != tt.expected {
			t.Errorf("HasPermission(%v, %q) = %v, want %v",
				tt.permissions, tt.required, got, tt.expected)
		}
	}
}

func TestAddAndRemoveToken(t *testing.T) {
	ta := NewTokenAuth(testSecurityConfig())

	// Add new token
	ta.AddToken("new_user", "sk_new_token", []string{"read"}, 30)

	// Verify it works
	principal, err := ta.VerifyToken("sk_new_token")
	if err != nil {
		t.Fatalf("new token should be valid: %v", err)
	}
	if principal.Name != "new_user" {
		t.Errorf("name = %q, want 'new_user'", principal.Name)
	}

	// Remove it
	removed := ta.RemoveToken("new_user")
	if !removed {
		t.Error("token should have been removed")
	}

	// Verify it no longer works
	_, err = ta.VerifyToken("sk_new_token")
	if err == nil {
		t.Error("removed token should be invalid")
	}
}
