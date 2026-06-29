package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// Config is the root configuration structure for OpenX V2.
type Config struct {
	Plugins  PluginsConfig  `yaml:"plugins"`
	AI       AIConfig       `yaml:"ai"`
	Bridge   BridgeConfig   `yaml:"bridge"`
	Server   ServerConfig   `yaml:"server"`
	Dev      DevConfig      `yaml:"dev"`
	Memory   MemoryConfig   `yaml:"memory"`
	Browser  BrowserConfig  `yaml:"browser"`
	Mode     ModeConfig     `yaml:"mode"`
	Security SecurityConfig `yaml:"security"`
	Logging  LoggingConfig  `yaml:"logging"`
	Error    ErrorConfig    `yaml:"error"`
}

// ServerConfig controls server transport modes.
type ServerConfig struct {
	HTTPPort int  `yaml:"http_port"` // HTTP API port (0 = disabled)
	Stdio    bool `yaml:"stdio"`     // Enable stdio transport for Cline
	APIKey   string `yaml:"api_key" json:"apiKey"`
}

// DevConfig controls development/testing behavior.
type DevConfig struct {
	MockDevice bool `yaml:"mock_device"`
}

// PluginsConfig toggles which plugins are loaded.
type PluginsConfig struct {
	Shell        bool `yaml:"shell"`
	Device       bool `yaml:"device"`
	File         bool `yaml:"file"`
	WhatsApp     bool `yaml:"whatsapp"`
	Clipboard    bool `yaml:"clipboard"`
	Notification bool `yaml:"notification"`
	AI           bool `yaml:"ai"`
	Cron         bool `yaml:"cron"`
	Memory       bool `yaml:"memory"`
	Browser      bool `yaml:"browser"`
}

// AIConfig holds AI provider settings.
type AIConfig struct {
	// Common fields
	Provider string `yaml:"provider"` // "openrouter" | "custom"

	// OpenRouter settings
	APIKey string   `yaml:"api_key"`
	APIKeys []string `yaml:"api_keys"` // multiple keys for rotation
	Model  string   `yaml:"model"`

	// Custom REST API settings
	BaseURL    string            `yaml:"base_url"`
	Method     string            `yaml:"method"`      // "GET" | "POST"
	ParamName  string            `yaml:"param_name"`  // query/body param name for prompt
	APIKeyParam string           `yaml:"apikey_param"` // query/body param name for API key
	AnswerField string           `yaml:"answer_field"` // dot-notation path to extract answer
	Headers    map[string]string `yaml:"headers"`
}

// BridgeConfig holds Baileys bridge settings.
type BridgeConfig struct {
	BaileysURL string `yaml:"baileys_url"`
}

// MemoryConfig holds context memory plugin settings.
type MemoryConfig struct {
	StoragePath  string `yaml:"storage_path"`
	MaxSizeBytes int64  `yaml:"max_size_bytes"`
	AutoBackup   bool   `yaml:"auto_backup"`
	BackupCount  int    `yaml:"backup_count"`
}

// BrowserConfig holds browser/web search plugin settings.
type BrowserConfig struct {
	DefaultProvider     string `yaml:"default_provider"`
	JinaTimeoutSeconds  int    `yaml:"jina_timeout_seconds"`
	UserAgent           string `yaml:"user_agent"`
	CacheResponses      bool   `yaml:"cache_responses"`
	CacheDir            string `yaml:"cache_dir"`
	MaxContentSizeBytes int64  `yaml:"max_content_size_bytes"`
	MaxCacheEntries     int    `yaml:"max_cache_entries"`
	CacheTTLSeconds     int    `yaml:"cache_ttl_seconds"`
	SSRFProtection      bool   `yaml:"ssrf_protection" json:"ssrfProtection"`
}

// ModeConfig controls multi-mode operation (local/remote/mock).
type ModeConfig struct {
	AutoDetect bool             `yaml:"auto_detect"`
	Local      LocalModeConfig  `yaml:"local"`
	Remote     RemoteModeConfig `yaml:"remote"`
}

// LocalModeConfig holds settings for local (Android/Termux) mode.
type LocalModeConfig struct {
	Enabled       bool   `yaml:"enabled"`
	TermuxSocket  string `yaml:"termux_socket"`
	SysfsBase     string `yaml:"sysfs_base"`
}

// RemoteModeConfig holds settings for remote (VPS/PC bridge) mode.
type RemoteModeConfig struct {
	Enabled      bool   `yaml:"enabled"`
	SSHHost      string `yaml:"ssh_host"`
	SSHPort      int    `yaml:"ssh_port"`
	SSHKey       string `yaml:"ssh_key"`
	SSHPassword  string `yaml:"ssh_password"` // password auth (alternative to key)
	SSHUser      string `yaml:"ssh_user"`
	ADBMode      bool   `yaml:"adb_mode"`
	TailscaleIP  string `yaml:"tailscale_ip"`
	USBSerial    string `yaml:"usb_serial"` // USB device serial (from adb devices)
}

// SecurityConfig holds authentication and authorization settings.
type SecurityConfig struct {
	Enabled         bool              `yaml:"enabled"`
	AuthMode        string            `yaml:"auth_mode"`
	Tokens          []TokenConfig     `yaml:"tokens"`
	ToolPermissions map[string]string `yaml:"tool_permissions"`
	RateLimit       RateLimitConfig   `yaml:"rate_limit"`
}

// TokenConfig defines a single API token and its permissions.
type TokenConfig struct {
	Name               string   `yaml:"name"`
	Token              string   `yaml:"token"`
	Permissions        []string `yaml:"permissions"`
	RateLimitPerMinute int      `yaml:"rate_limit_per_minute"`
}

// RateLimitConfig holds rate limiting settings.
type RateLimitConfig struct {
	Enabled       bool `yaml:"enabled"`
	WindowSeconds int  `yaml:"window_seconds"`
	BurstSize     int  `yaml:"burst_size"`
}

// LoggingConfig holds structured logging settings.
type LoggingConfig struct {
	Level      string            `yaml:"level"`
	Format     string            `yaml:"format"`
	Output     string            `yaml:"output"`
	File       string            `yaml:"file"`
	MaxSizeMB  int               `yaml:"max_size_mb"`
	MaxBackups int               `yaml:"max_backups"`
	MaxDays    int               `yaml:"max_days"`
	Modules    map[string]string `yaml:"modules"`
}

// ErrorConfig holds error handling and crash recovery settings.
type ErrorConfig struct {
	AutoRestart       bool    `yaml:"auto_restart"`
	BackoffMultiplier float64 `yaml:"backoff_multiplier"`
	MaxBackoffSeconds int     `yaml:"max_backoff_seconds"`
	SavePanicDump     bool    `yaml:"save_panic_dump"`
	DumpDir           string  `yaml:"dump_dir"`
	GCThresholdMB     int     `yaml:"gc_threshold_mb" json:"gcThresholdMB"`
}

// Load reads and parses the configuration file.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config file: %w", err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config file: %w", err)
	}

	// Apply defaults
	applyDefaults(&cfg)

	// Override with environment variables (for production deployment)
	applyEnvOverrides(&cfg)

	return &cfg, nil
}

// applyDefaults sets sensible default values for unset config fields.
func applyDefaults(cfg *Config) {
	// Memory defaults
	if cfg.Memory.StoragePath == "" {
		cfg.Memory.StoragePath = "openx-memory.json"
	}
	if cfg.Memory.MaxSizeBytes == 0 {
		cfg.Memory.MaxSizeBytes = 10 * 1024 * 1024 // 10MB
	}
	if cfg.Memory.BackupCount == 0 {
		cfg.Memory.BackupCount = 3
	}

	// Server defaults
	if cfg.Server.HTTPPort == 0 && !cfg.Server.Stdio {
		// If neither is configured, enable both with defaults
		cfg.Server.HTTPPort = 8765
		cfg.Server.Stdio = true
	}
	if cfg.Server.Stdio && cfg.Server.HTTPPort == 0 {
		// Stdio only, HTTP disabled — that's fine
	}

	// Browser defaults
	if cfg.Browser.DefaultProvider == "" {
		cfg.Browser.DefaultProvider = "jina"
	}
	if cfg.Browser.JinaTimeoutSeconds == 0 {
		cfg.Browser.JinaTimeoutSeconds = 10
	}
	if cfg.Browser.UserAgent == "" {
		cfg.Browser.UserAgent = "OpenX-V2/1.0"
	}
	if cfg.Browser.MaxContentSizeBytes == 0 {
		cfg.Browser.MaxContentSizeBytes = 1024 * 1024 // 1MB
	}
	if cfg.Browser.MaxCacheEntries == 0 {
		cfg.Browser.MaxCacheEntries = 100
	}
	if cfg.Browser.CacheTTLSeconds == 0 {
		cfg.Browser.CacheTTLSeconds = 300 // 5 minutes
	}

	// Mode defaults
	if cfg.Mode.Local.SysfsBase == "" {
		cfg.Mode.Local.SysfsBase = "/sys"
	}
	if cfg.Mode.Remote.SSHPort == 0 {
		cfg.Mode.Remote.SSHPort = 22
	}

	// Security defaults
	if cfg.Security.AuthMode == "" {
		cfg.Security.AuthMode = "token"
	}
	if cfg.Security.RateLimit.WindowSeconds == 0 {
		cfg.Security.RateLimit.WindowSeconds = 60
	}
	if cfg.Security.RateLimit.BurstSize == 0 {
		cfg.Security.RateLimit.BurstSize = 10
	}

	// Logging defaults
	if cfg.Logging.Level == "" {
		cfg.Logging.Level = "info"
	}
	if cfg.Logging.Format == "" {
		cfg.Logging.Format = "json"
	}
	if cfg.Logging.Output == "" {
		cfg.Logging.Output = "stderr"
	}
	if cfg.Logging.MaxSizeMB == 0 {
		cfg.Logging.MaxSizeMB = 10
	}
	if cfg.Logging.MaxBackups == 0 {
		cfg.Logging.MaxBackups = 5
	}
	if cfg.Logging.MaxDays == 0 {
		cfg.Logging.MaxDays = 7
	}

	// Error defaults
	if cfg.Error.BackoffMultiplier == 0 {
		cfg.Error.BackoffMultiplier = 1.5
	}
	if cfg.Error.MaxBackoffSeconds == 0 {
		cfg.Error.MaxBackoffSeconds = 300
	}
	if cfg.Error.DumpDir == "" {
		cfg.Error.DumpDir = "openx-crashes"
	}
	if cfg.Error.GCThresholdMB == 0 {
		cfg.Error.GCThresholdMB = 512
	}

	// Browser defaults
	if !cfg.Browser.SSRFProtection {
		cfg.Browser.SSRFProtection = true
	}
}

// applyEnvOverrides reads environment variables and overrides config values.
// This allows deploying with the same config.yaml but different env vars.
func applyEnvOverrides(cfg *Config) {
	// Server
	if v := os.Getenv("OPENX_SERVER_HTTP_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil {
			cfg.Server.HTTPPort = port
		}
	}
	if v := os.Getenv("OPENX_SERVER_STDIO"); v != "" {
		cfg.Server.Stdio = strings.ToLower(v) == "true"
	}
	cfg.Server.APIKey = getEnvOrDefault("OPENX_MCP_API_KEY", cfg.Server.APIKey)

	// AI
	if v := os.Getenv("OPENX_AI_PROVIDER"); v != "" {
		cfg.AI.Provider = v
	}
	if v := os.Getenv("OPENX_AI_API_KEY"); v != "" {
		cfg.AI.APIKey = v
	}
	if v := os.Getenv("OPENX_AI_MODEL"); v != "" {
		cfg.AI.Model = v
	}
	if v := os.Getenv("OPENX_AI_BASE_URL"); v != "" {
		cfg.AI.BaseURL = v
	}

	// Dev / Mock mode
	if v := os.Getenv("OPENX_MOCK_DEVICE"); v != "" {
		cfg.Dev.MockDevice = strings.ToLower(v) == "true"
	}

	// Remote mode (SSH to Android)
	if v := os.Getenv("OPENX_MODE_REMOTE_SSH_HOST"); v != "" {
		cfg.Mode.Remote.Enabled = true
		cfg.Mode.AutoDetect = false
		cfg.Mode.Remote.SSHHost = v
	}
	if v := os.Getenv("OPENX_MODE_REMOTE_SSH_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil {
			cfg.Mode.Remote.SSHPort = port
		}
	}
	if v := os.Getenv("OPENX_MODE_REMOTE_SSH_USER"); v != "" {
		cfg.Mode.Remote.SSHUser = v
	}
	if v := os.Getenv("OPENX_MODE_REMOTE_SSH_KEY"); v != "" {
		// Detect if it's a private key or password
		if strings.HasPrefix(v, "-----BEGIN") {
			// It's an inline private key, write to temp file
			tmpFile := "/tmp/openx_ssh_key"
			if err := os.WriteFile(tmpFile, []byte(v), 0600); err == nil {
				cfg.Mode.Remote.SSHKey = tmpFile
			}
		} else if _, err := os.Stat(v); err == nil {
			// It's a file path
			cfg.Mode.Remote.SSHKey = v
		} else {
			// Treat as password
			cfg.Mode.Remote.SSHPassword = v
		}
	}
	if v := os.Getenv("OPENX_MODE_REMOTE_ADB_MODE"); v != "" {
		cfg.Mode.Remote.ADBMode = strings.ToLower(v) == "true"
	}
	if v := os.Getenv("OPENX_MODE_REMOTE_TAILSCALE_IP"); v != "" {
		cfg.Mode.Remote.TailscaleIP = v
	}
	if v := os.Getenv("OPENX_MODE_REMOTE_USB_SERIAL"); v != "" {
		cfg.Mode.Remote.USBSerial = v
	}

	// Security / HTTP API auth
	if v := os.Getenv("OPENX_HTTP_API_KEY"); v != "" {
		cfg.Security.Enabled = true
		// Store in a custom field or use existing token mechanism
		if cfg.Security.Tokens == nil {
			cfg.Security.Tokens = []TokenConfig{}
		}
		cfg.Security.Tokens = append(cfg.Security.Tokens, TokenConfig{
			Name:        "http-api",
			Token:       v,
			Permissions: []string{"read", "execute", "admin"},
		})
	}

	// Logging
	if v := os.Getenv("OPENX_LOG_LEVEL"); v != "" {
		cfg.Logging.Level = v
	}
}

func getEnvOrDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}
