package devicecontext

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// RemoteADBClient provides device access over ADB (Android Debug Bridge).
// Used when connecting to an Android device via ADB over network or USB.
type RemoteADBClient struct {
	deviceAddr string // e.g., "100.x.x.x:5555" (TCP) or "ABC123" (USB serial)
	isUSB      bool   // true when connected via USB (no adb connect needed)
}

// NewRemoteADBClient creates a new ADB-based device client.
// If target contains ":" it's treated as TCP (adb connect required).
// If target has no ":", it's treated as a USB serial (no adb connect).
func NewRemoteADBClient(target string) (*RemoteADBClient, error) {
	if target == "" {
		return nil, fmt.Errorf("ADB target cannot be empty")
	}

	// USB mode: serial has no colon
	if !strings.Contains(target, ":") {
		client := &RemoteADBClient{deviceAddr: target, isUSB: true}
		// Verify USB device is reachable
		if err := client.verifyUSBDevice(); err != nil {
			return nil, fmt.Errorf("USB device verification failed: %w", err)
		}
		return client, nil
	}

	// TCP mode: needs adb connect
	client := &RemoteADBClient{deviceAddr: target, isUSB: false}
	if err := client.connectDevice(); err != nil {
		return nil, fmt.Errorf("ADB connect failed: %w", err)
	}
	return client, nil
}

// verifyUSBDevice checks that a USB device with this serial is connected.
func (adb *RemoteADBClient) verifyUSBDevice() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "adb", "devices")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("adb devices: %w", err)
	}

	lines := strings.Split(string(output), "\n")
	for _, line := range lines[1:] { // skip header
		if strings.Contains(line, adb.deviceAddr) && strings.Contains(line, "\tdevice") {
			return nil
		}
	}
	return fmt.Errorf("device %s not found in adb devices output", adb.deviceAddr)
}

// connectDevice connects to the ADB device.
func (adb *RemoteADBClient) connectDevice() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "adb", "connect", adb.deviceAddr)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("adb connect: %w, output: %s", err, string(output))
	}

	outputStr := string(output)
	if !strings.Contains(outputStr, "connected") && !strings.Contains(outputStr, "already connected") {
		return fmt.Errorf("adb connect failed: %s", outputStr)
	}

	return nil
}

// ExecuteCommand runs a command on the device via ADB shell.
func (adb *RemoteADBClient) ExecuteCommand(ctx context.Context, cmd string) (string, error) {
	// Default timeout
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
	}

	adbCmd := exec.CommandContext(ctx, "adb", "-s", adb.deviceAddr, "shell", cmd)

	var stdout, stderr bytes.Buffer
	adbCmd.Stdout = &stdout
	adbCmd.Stderr = &stderr

	err := adbCmd.Run()

	if ctx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("ADB command timed out: %s", cmd)
	}

	if err != nil {
		return "", fmt.Errorf("ADB command failed: %v, stderr: %s", err, stderr.String())
	}

	return strings.TrimSpace(stdout.String()), nil
}

// ExecuteCommandArgs runs a command with separate arguments via ADB shell.
func (adb *RemoteADBClient) ExecuteCommandArgs(ctx context.Context, name string, args ...string) (string, error) {
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
	}

	parts := make([]string, 0, len(args)+1)
	parts = append(parts, name)
	parts = append(parts, args...)
	cmd := strings.Join(parts, " ")

	adbCmd := exec.CommandContext(ctx, "adb", "-s", adb.deviceAddr, "shell", cmd)

	var stdout, stderr bytes.Buffer
	adbCmd.Stdout = &stdout
	adbCmd.Stderr = &stderr

	err := adbCmd.Run()

	if ctx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("ADB command timed out: %s", cmd)
	}

	if err != nil {
		return "", fmt.Errorf("ADB command failed: %v, stderr: %s", err, stderr.String())
	}

	return strings.TrimSpace(stdout.String()), nil
}

// ReadFile reads a file from the device via ADB shell cat.
func (adb *RemoteADBClient) ReadFile(ctx context.Context, path string) ([]byte, error) {
	output, err := adb.ExecuteCommand(ctx, fmt.Sprintf("cat %q", path))
	if err != nil {
		return nil, fmt.Errorf("ADB read file %s: %w", path, err)
	}
	return []byte(output), nil
}

// WriteFile writes data to a file on the device via ADB shell.
func (adb *RemoteADBClient) WriteFile(ctx context.Context, path string, data []byte) error {
	// Use printf to write data (handles special characters better than echo)
	cmd := fmt.Sprintf("printf '%%s' %q > %q", string(data), path)
	_, err := adb.ExecuteCommand(ctx, cmd)
	if err != nil {
		return fmt.Errorf("ADB write file %s: %w", path, err)
	}
	return nil
}

// GetBatteryStatus reads battery info via ADB.
func (adb *RemoteADBClient) GetBatteryStatus(ctx context.Context) (*BatteryInfo, error) {
	// Use dumpsys battery for comprehensive info
	output, err := adb.ExecuteCommand(ctx, "dumpsys battery")
	if err != nil {
		// Fallback to sysfs
		return adb.getBatteryFromSysfs(ctx)
	}

	info := &BatteryInfo{}

	lines := strings.Split(output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}

		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])

		switch key {
		case "level":
			info.Level, _ = strconv.Atoi(value)
		case "status":
			switch value {
			case "2":
				info.Status = "Charging"
			case "3":
				info.Status = "Discharging"
			case "4":
				info.Status = "Not charging"
			case "5":
				info.Status = "Full"
			default:
				info.Status = "Unknown"
			}
		case "temperature":
			if temp, err := strconv.Atoi(value); err == nil {
				info.Temperature = temp / 10
			}
		case "health":
			switch value {
			case "2":
				info.Health = "Good"
			case "3":
				info.Health = "Overheat"
			case "4":
				info.Health = "Dead"
			default:
				info.Health = "Unknown"
			}
		}
	}

	return info, nil
}

// getBatteryFromSysfs reads battery info from sysfs via ADB.
func (adb *RemoteADBClient) getBatteryFromSysfs(ctx context.Context) (*BatteryInfo, error) {
	info := &BatteryInfo{}

	output, _ := adb.ExecuteCommand(ctx, "cat /sys/class/power_supply/battery/capacity 2>/dev/null")
	info.Level, _ = strconv.Atoi(strings.TrimSpace(output))

	output, _ = adb.ExecuteCommand(ctx, "cat /sys/class/power_supply/battery/status 2>/dev/null")
	info.Status = strings.TrimSpace(output)

	return info, nil
}

// GetNetworkStats reads network stats via ADB.
func (adb *RemoteADBClient) GetNetworkStats(ctx context.Context) (*NetworkStats, error) {
	output, err := adb.ExecuteCommand(ctx, "cat /proc/net/dev")
	if err != nil {
		return nil, fmt.Errorf("ADB read /proc/net/dev: %w", err)
	}

	stats := &NetworkStats{Connection: "unknown"}

	lines := strings.Split(output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.Contains(line, "|") || line == "" {
			continue
		}

		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}

		iface := strings.TrimSpace(parts[0])
		if iface == "lo" {
			continue
		}

		fields := strings.Fields(parts[1])
		if len(fields) < 9 {
			continue
		}

		rxBytes, _ := strconv.ParseInt(fields[0], 10, 64)
		txBytes, _ := strconv.ParseInt(fields[8], 10, 64)

		if rxBytes+txBytes > stats.RxBytes+stats.TxBytes {
			stats.Interface = iface
			stats.RxBytes = rxBytes
			stats.TxBytes = txBytes

			switch {
			case strings.HasPrefix(iface, "wlan"):
				stats.Connection = "wifi"
			case strings.HasPrefix(iface, "rmnet"):
				stats.Connection = "cellular"
			default:
				stats.Connection = iface
			}
		}
	}

	return stats, nil
}

// GetDeviceInfo reads device info via ADB.
func (adb *RemoteADBClient) GetDeviceInfo(ctx context.Context) (*DeviceInfo, error) {
	info := &DeviceInfo{OS: "android"}

	// Device model as hostname
	if output, err := adb.ExecuteCommand(ctx, "getprop ro.product.model"); err == nil {
		info.Hostname = strings.TrimSpace(output)
	}

	// Architecture
	if output, err := adb.ExecuteCommand(ctx, "getprop ro.product.cpu.abi"); err == nil {
		info.Arch = strings.TrimSpace(output)
	}

	// Uptime
	if output, err := adb.ExecuteCommand(ctx, "cat /proc/uptime"); err == nil {
		fields := strings.Fields(output)
		if len(fields) > 0 {
			info.Uptime = fields[0] + "s"
		}
	}

	// Memory
	if output, err := adb.ExecuteCommand(ctx, "cat /proc/meminfo"); err == nil {
		lines := strings.Split(output, "\n")
		for _, line := range lines {
			if strings.HasPrefix(line, "MemTotal:") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					info.MemTotal, _ = strconv.ParseInt(fields[1], 10, 64)
				}
			}
			if strings.HasPrefix(line, "MemAvailable:") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					info.MemFree, _ = strconv.ParseInt(fields[1], 10, 64)
				}
			}
		}
	}

	return info, nil
}

// Close disconnects from the ADB device.
func (adb *RemoteADBClient) Close() error {
	// USB devices don't need disconnect
	if adb.isUSB {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "adb", "disconnect", adb.deviceAddr)
	cmd.Run() // Best effort
	return nil
}
