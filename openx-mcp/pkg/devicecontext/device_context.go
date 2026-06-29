// Package devicecontext provides hardware abstraction for OpenX V2.
// It supports multiple execution modes: local (Android/Termux), remote (SSH/ADB),
// and mock (development PC). The DeviceClient interface abstracts all device
// operations so plugins work identically regardless of mode.
package devicecontext

import (
	"context"
	"fmt"

	"github.com/notzeyyc/openx-v2/config"
	"github.com/notzeyyc/openx-v2/pkg/logging"
)

// DeviceMode represents the execution environment.
type DeviceMode string

const (
	ModeLocal  DeviceMode = "local"
	ModeRemote DeviceMode = "remote"
	ModeMock   DeviceMode = "mock"
)

// BatteryInfo holds battery status information.
type BatteryInfo struct {
	Level       int    `json:"level"`
	Status      string `json:"status"`
	Temperature int    `json:"temperature"`
	Health      string `json:"health"`
}

// NetworkStats holds network connectivity information.
type NetworkStats struct {
	Connection string `json:"connection"`
	RxBytes    int64  `json:"rx_bytes"`
	TxBytes    int64  `json:"tx_bytes"`
	Interface  string `json:"interface"`
}

// DeviceInfo holds general device information.
type DeviceInfo struct {
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	Uptime   string `json:"uptime"`
	MemTotal int64  `json:"mem_total_kb"`
	MemFree  int64  `json:"mem_free_kb"`
}

// DeviceClient defines the interface for all device operations.
// Implementations exist for local (Termux), remote (SSH/ADB), and mock modes.
type DeviceClient interface {
	// ExecuteCommand runs a shell command on the device.
	ExecuteCommand(ctx context.Context, cmd string) (string, error)

	// ExecuteCommandArgs runs a command with separate arguments, avoiding shell interpretation.
	ExecuteCommandArgs(ctx context.Context, name string, args ...string) (string, error)

	// ReadFile reads a file from the device filesystem.
	ReadFile(ctx context.Context, path string) ([]byte, error)

	// WriteFile writes data to a file on the device.
	WriteFile(ctx context.Context, path string, data []byte) error

	// GetBatteryStatus returns current battery information.
	GetBatteryStatus(ctx context.Context) (*BatteryInfo, error)

	// GetNetworkStats returns current network statistics.
	GetNetworkStats(ctx context.Context) (*NetworkStats, error)

	// GetDeviceInfo returns general device information.
	GetDeviceInfo(ctx context.Context) (*DeviceInfo, error)

	// Close cleans up any resources held by the client.
	Close() error
}

// DeviceContext holds the detected device mode and provides the client interface.
type DeviceContext struct {
	Mode        DeviceMode
	Client      DeviceClient
	BatteryPath string // Legacy field for backward compatibility
	logger      *logging.Logger
}

// NewDeviceContext creates a DeviceContext based on configuration.
// It auto-detects the mode or uses the configured mode.
func NewDeviceContext(cfg *config.Config) (*DeviceContext, error) {
	logger := logging.GetLogger("devicecontext")

	mode := detectMode(cfg)
	logger.Infof("detected device mode: %s", mode)

	var client DeviceClient
	var err error

	switch mode {
	case ModeLocal:
		client, err = NewLocalDeviceClient(cfg.Mode.Local.SysfsBase)
		if err != nil {
			return nil, fmt.Errorf("create local device client: %w", err)
		}
	case ModeRemote:
		// USB serial takes priority over TCP ADB
		if cfg.Mode.Remote.USBSerial != "" {
			client, err = NewRemoteADBClient(cfg.Mode.Remote.USBSerial)
		} else if cfg.Mode.Remote.ADBMode {
			client, err = NewRemoteADBClient(cfg.Mode.Remote.TailscaleIP)
		} else {
			client, err = NewRemoteSSHClient(
				cfg.Mode.Remote.SSHHost,
				cfg.Mode.Remote.SSHPort,
				cfg.Mode.Remote.SSHUser,
				cfg.Mode.Remote.SSHKey,
				cfg.Mode.Remote.SSHPassword,
			)
		}
		if err != nil {
			logger.Warnf("remote client creation failed, falling back to mock: %v", err)
			client = NewMockDeviceClient()
			mode = ModeMock
		}
	case ModeMock:
		client = NewMockDeviceClient()
	default:
		client = NewMockDeviceClient()
		mode = ModeMock
	}

	// Detect battery path for legacy compatibility
	batteryPath, _ := DetectBatteryPath()

	return &DeviceContext{
		Mode:        mode,
		Client:      client,
		BatteryPath: batteryPath,
		logger:      logger,
	}, nil
}

// NewDeviceContextLegacy creates a DeviceContext using the old API (for backward compatibility).
// It always creates a mock client.
func NewDeviceContextLegacy() (*DeviceContext, error) {
	batteryPath, _ := DetectBatteryPath()
	return &DeviceContext{
		Mode:        ModeMock,
		Client:      NewMockDeviceClient(),
		BatteryPath: batteryPath,
		logger:      logging.GetLogger("devicecontext"),
	}, nil
}

// Close cleans up the device client resources.
func (dc *DeviceContext) Close() error {
	if dc.Client != nil {
		return dc.Client.Close()
	}
	return nil
}

// DetectBatteryPath attempts to find the battery sysfs directory by checking common paths.
// Returns first valid path, or empty string if none found.
func DetectBatteryPath() (string, error) {
	paths := []string{
		"/sys/class/power_supply/battery",
		"/sys/class/power_supply/Battery",
		"/sys/class/power_supply/BAT0",
		"/sys/class/power_supply/BAT1",
	}

	for _, p := range paths {
		if isDir(p) {
			return p, nil
		}
	}

	return "", fmt.Errorf("battery sysfs not found on this device")
}
