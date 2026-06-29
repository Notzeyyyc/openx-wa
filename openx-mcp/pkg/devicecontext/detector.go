package devicecontext

import (
	"os"
	"runtime"

	"github.com/notzeyyc/openx-v2/config"
)

// detectMode determines the device mode based on configuration and environment.
func detectMode(cfg *config.Config) DeviceMode {
	// If mock_device is explicitly set, use mock mode
	if cfg.Dev.MockDevice {
		return ModeMock
	}

	// If remote mode is explicitly enabled, use remote
	if cfg.Mode.Remote.Enabled {
		return ModeRemote
	}

	// If auto-detect is enabled, try to detect
	if cfg.Mode.AutoDetect {
		if isAndroidDevice() {
			return ModeLocal
		}
	}

	// If local mode is explicitly enabled and we're on Linux
	if cfg.Mode.Local.Enabled && runtime.GOOS == "linux" {
		return ModeLocal
	}

	// Default to mock
	return ModeMock
}

// isAndroidDevice checks if we're running on an Android device.
func isAndroidDevice() bool {
	// Check for Android-specific files
	androidIndicators := []string{
		"/system/build.prop",                              // Android system
		"/data/data/com.termux",                           // Termux installed
		"/data/data/com.termux/files/usr/bin/termux-info", // Termux binary
	}

	for _, path := range androidIndicators {
		if fileExists(path) {
			return true
		}
	}

	// Check for Termux environment variable
	if os.Getenv("TERMUX_VERSION") != "" {
		return true
	}

	// Check PREFIX (Termux sets this)
	if prefix := os.Getenv("PREFIX"); prefix == "/data/data/com.termux/files/usr" {
		return true
	}

	return false
}

// fileExists checks if a file exists.
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// isDir checks if a path is a directory.
func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}
