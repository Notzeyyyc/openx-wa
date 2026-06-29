package devicecontext

import (
	"context"
	"fmt"
	"runtime"
	"strings"
)

// MockDeviceClient provides fake device responses for development/testing.
// It returns consistent mock data without requiring real hardware access.
type MockDeviceClient struct{}

// NewMockDeviceClient creates a new mock device client.
func NewMockDeviceClient() *MockDeviceClient {
	return &MockDeviceClient{}
}

// ExecuteCommand returns a mock command output.
func (mdc *MockDeviceClient) ExecuteCommand(ctx context.Context, cmd string) (string, error) {
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	default:
	}

	return fmt.Sprintf("[mock] executed: %s\nOutput: command completed successfully", cmd), nil
}

// ExecuteCommandArgs returns a mock command output.
func (mdc *MockDeviceClient) ExecuteCommandArgs(ctx context.Context, name string, args ...string) (string, error) {
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	default:
	}

	parts := make([]string, 0, len(args)+1)
	parts = append(parts, name)
	parts = append(parts, args...)
	cmd := strings.Join(parts, " ")

	return fmt.Sprintf("[mock] executed: %s\nOutput: command completed successfully", cmd), nil
}

// ReadFile returns mock file content.
func (mdc *MockDeviceClient) ReadFile(ctx context.Context, path string) ([]byte, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}

	return []byte(fmt.Sprintf("[mock] content of %s", path)), nil
}

// WriteFile pretends to write a file.
func (mdc *MockDeviceClient) WriteFile(ctx context.Context, path string, data []byte) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	return nil
}

// GetBatteryStatus returns mock battery information.
func (mdc *MockDeviceClient) GetBatteryStatus(ctx context.Context) (*BatteryInfo, error) {
	return &BatteryInfo{
		Level:       85,
		Status:      "Charging",
		Temperature: 32,
		Health:      "Good",
	}, nil
}

// GetNetworkStats returns mock network statistics.
func (mdc *MockDeviceClient) GetNetworkStats(ctx context.Context) (*NetworkStats, error) {
	return &NetworkStats{
		Connection: "wifi",
		RxBytes:    1234567,
		TxBytes:    7654321,
		Interface:  "wlan0",
	}, nil
}

// GetDeviceInfo returns mock device information.
func (mdc *MockDeviceClient) GetDeviceInfo(ctx context.Context) (*DeviceInfo, error) {
	return &DeviceInfo{
		Hostname: "mock-device",
		OS:       "android-mock",
		Arch:     runtime.GOARCH,
		Uptime:   "12345.67s",
		MemTotal: 4096000,
		MemFree:  2048000,
	}, nil
}

// Close is a no-op for mock client.
func (mdc *MockDeviceClient) Close() error {
	return nil
}
