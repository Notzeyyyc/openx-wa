package devicecontext

import (
	"context"
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

func TestDetectModeMock(t *testing.T) {
	cfg := &config.Config{
		Dev: config.DevConfig{MockDevice: true},
	}

	mode := detectMode(cfg)
	if mode != ModeMock {
		t.Errorf("mode = %q, want %q", mode, ModeMock)
	}
}

func TestDetectModeRemote(t *testing.T) {
	cfg := &config.Config{
		Dev: config.DevConfig{MockDevice: false},
		Mode: config.ModeConfig{
			Remote: config.RemoteModeConfig{
				Enabled: true,
				SSHHost: "user@device.local",
			},
		},
	}

	mode := detectMode(cfg)
	if mode != ModeRemote {
		t.Errorf("mode = %q, want %q", mode, ModeRemote)
	}
}

func TestDetectModeDefaultMock(t *testing.T) {
	// On a development PC (not Android), should default to mock
	cfg := &config.Config{
		Dev: config.DevConfig{MockDevice: false},
		Mode: config.ModeConfig{
			AutoDetect: true,
		},
	}

	mode := detectMode(cfg)
	// On a non-Android system, this should be mock
	// (unless running on actual Android)
	if mode != ModeMock && mode != ModeLocal {
		t.Errorf("mode = %q, want mock or local", mode)
	}
}

func TestMockDeviceClient(t *testing.T) {
	client := NewMockDeviceClient()
	ctx := context.Background()

	// Test battery
	battery, err := client.GetBatteryStatus(ctx)
	if err != nil {
		t.Fatalf("GetBatteryStatus failed: %v", err)
	}
	if battery.Level != 85 {
		t.Errorf("battery level = %d, want 85", battery.Level)
	}
	if battery.Status != "Charging" {
		t.Errorf("battery status = %q, want 'Charging'", battery.Status)
	}

	// Test network
	network, err := client.GetNetworkStats(ctx)
	if err != nil {
		t.Fatalf("GetNetworkStats failed: %v", err)
	}
	if network.Connection != "wifi" {
		t.Errorf("connection = %q, want 'wifi'", network.Connection)
	}

	// Test device info
	info, err := client.GetDeviceInfo(ctx)
	if err != nil {
		t.Fatalf("GetDeviceInfo failed: %v", err)
	}
	if info.Hostname != "mock-device" {
		t.Errorf("hostname = %q, want 'mock-device'", info.Hostname)
	}

	// Test execute command
	output, err := client.ExecuteCommand(ctx, "echo hello")
	if err != nil {
		t.Fatalf("ExecuteCommand failed: %v", err)
	}
	if output == "" {
		t.Error("output should not be empty")
	}

	// Test close
	if err := client.Close(); err != nil {
		t.Errorf("Close failed: %v", err)
	}
}

func TestMockDeviceClientContextCancellation(t *testing.T) {
	client := NewMockDeviceClient()
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, err := client.ExecuteCommand(ctx, "echo hello")
	if err == nil {
		t.Error("expected error for cancelled context")
	}
}

func TestNewDeviceContextWithMockConfig(t *testing.T) {
	cfg := &config.Config{
		Dev: config.DevConfig{MockDevice: true},
		Mode: config.ModeConfig{
			Local: config.LocalModeConfig{
				SysfsBase: "/sys",
			},
		},
	}

	dctx, err := NewDeviceContext(cfg)
	if err != nil {
		t.Fatalf("NewDeviceContext failed: %v", err)
	}

	if dctx.Mode != ModeMock {
		t.Errorf("mode = %q, want %q", dctx.Mode, ModeMock)
	}

	if dctx.Client == nil {
		t.Fatal("client should not be nil")
	}

	// Verify mock client works
	battery, err := dctx.Client.GetBatteryStatus(context.Background())
	if err != nil {
		t.Fatalf("GetBatteryStatus failed: %v", err)
	}
	if battery.Level != 85 {
		t.Errorf("battery level = %d, want 85", battery.Level)
	}
}
