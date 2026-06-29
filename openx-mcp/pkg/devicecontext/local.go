package devicecontext

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// LocalDeviceClient provides direct access to the device via sysfs/procfs.
// Used when running directly on Android/Termux.
type LocalDeviceClient struct {
	sysfsBase string
}

// NewLocalDeviceClient creates a new local device client.
func NewLocalDeviceClient(sysfsBase string) (*LocalDeviceClient, error) {
	if sysfsBase == "" {
		sysfsBase = "/sys"
	}
	return &LocalDeviceClient{sysfsBase: sysfsBase}, nil
}

// ExecuteCommand runs a shell command locally with timeout.
func (ldc *LocalDeviceClient) ExecuteCommand(ctx context.Context, cmd string) (string, error) {
	// Default timeout of 30 seconds if context has no deadline
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
	}

	command := exec.CommandContext(ctx, "sh", "-c", cmd)

	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr

	err := command.Run()

	if ctx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("command timed out: %s", cmd)
	}

	if err != nil {
		return "", fmt.Errorf("command failed: %v, stderr: %s", err, stderr.String())
	}

	return strings.TrimSpace(stdout.String()), nil
}

// ExecuteCommandArgs runs a command with separate arguments, avoiding shell interpretation.
func (ldc *LocalDeviceClient) ExecuteCommandArgs(ctx context.Context, name string, args ...string) (string, error) {
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
	}

	command := exec.CommandContext(ctx, name, args...)

	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr

	err := command.Run()

	if ctx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("command timed out: %s %s", name, strings.Join(args, " "))
	}

	if err != nil {
		return "", fmt.Errorf("command failed: %v, stderr: %s", err, stderr.String())
	}

	return strings.TrimSpace(stdout.String()), nil
}

// ReadFile reads a file from the local filesystem.
func (ldc *LocalDeviceClient) ReadFile(ctx context.Context, path string) ([]byte, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read file %s: %w", path, err)
	}
	return data, nil
}

// WriteFile writes data to a file on the local filesystem.
func (ldc *LocalDeviceClient) WriteFile(ctx context.Context, path string, data []byte) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create directory %s: %w", dir, err)
	}

	return os.WriteFile(path, data, 0644)
}

// GetBatteryStatus reads battery information from sysfs.
func (ldc *LocalDeviceClient) GetBatteryStatus(ctx context.Context) (*BatteryInfo, error) {
	batteryPath := filepath.Join(ldc.sysfsBase, "class/power_supply/battery")

	// Try common battery paths
	paths := []string{
		batteryPath,
		filepath.Join(ldc.sysfsBase, "class/power_supply/Battery"),
		filepath.Join(ldc.sysfsBase, "class/power_supply/BAT0"),
	}

	var activePath string
	for _, p := range paths {
		if isDir(p) {
			activePath = p
			break
		}
	}

	if activePath == "" {
		return nil, fmt.Errorf("battery sysfs not found")
	}

	info := &BatteryInfo{}

	// Read capacity (level)
	if data, err := ldc.ReadFile(ctx, filepath.Join(activePath, "capacity")); err == nil {
		if level, err := strconv.Atoi(strings.TrimSpace(string(data))); err == nil {
			info.Level = level
		}
	}

	// Read status (Charging, Discharging, Full, Not charging)
	if data, err := ldc.ReadFile(ctx, filepath.Join(activePath, "status")); err == nil {
		info.Status = strings.TrimSpace(string(data))
	}

	// Read temperature (in tenths of degree Celsius)
	if data, err := ldc.ReadFile(ctx, filepath.Join(activePath, "temp")); err == nil {
		if temp, err := strconv.Atoi(strings.TrimSpace(string(data))); err == nil {
			info.Temperature = temp / 10
		}
	}

	// Read health
	if data, err := ldc.ReadFile(ctx, filepath.Join(activePath, "health")); err == nil {
		info.Health = strings.TrimSpace(string(data))
	}

	return info, nil
}

// GetNetworkStats reads network statistics from /proc/net/dev.
func (ldc *LocalDeviceClient) GetNetworkStats(ctx context.Context) (*NetworkStats, error) {
	data, err := ldc.ReadFile(ctx, "/proc/net/dev")
	if err != nil {
		return nil, fmt.Errorf("read /proc/net/dev: %w", err)
	}

	stats := &NetworkStats{Connection: "unknown"}

	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)

		// Skip header lines
		if strings.Contains(line, "|") || line == "" {
			continue
		}

		// Parse interface line: "wlan0: rx_bytes ... tx_bytes ..."
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}

		iface := strings.TrimSpace(parts[0])

		// Skip loopback
		if iface == "lo" {
			continue
		}

		fields := strings.Fields(parts[1])
		if len(fields) < 9 {
			continue
		}

		rxBytes, _ := strconv.ParseInt(fields[0], 10, 64)
		txBytes, _ := strconv.ParseInt(fields[8], 10, 64)

		// Use the interface with the most traffic
		if rxBytes+txBytes > stats.RxBytes+stats.TxBytes {
			stats.Interface = iface
			stats.RxBytes = rxBytes
			stats.TxBytes = txBytes

			// Determine connection type from interface name
			switch {
			case strings.HasPrefix(iface, "wlan"):
				stats.Connection = "wifi"
			case strings.HasPrefix(iface, "rmnet") || strings.HasPrefix(iface, "ccmni"):
				stats.Connection = "cellular"
			case strings.HasPrefix(iface, "eth"):
				stats.Connection = "ethernet"
			default:
				stats.Connection = iface
			}
		}
	}

	return stats, nil
}

// GetDeviceInfo reads general device information.
func (ldc *LocalDeviceClient) GetDeviceInfo(ctx context.Context) (*DeviceInfo, error) {
	info := &DeviceInfo{
		OS:   "linux",
		Arch: getArch(),
	}

	// Hostname
	if hostname, err := os.Hostname(); err == nil {
		info.Hostname = hostname
	}

	// Uptime from /proc/uptime
	if data, err := ldc.ReadFile(ctx, "/proc/uptime"); err == nil {
		fields := strings.Fields(string(data))
		if len(fields) > 0 {
			if uptime, err := strconv.ParseFloat(fields[0], 64); err == nil {
				duration := time.Duration(uptime * float64(time.Second))
				info.Uptime = duration.String()
			}
		}
	}

	// Memory from /proc/meminfo
	if data, err := ldc.ReadFile(ctx, "/proc/meminfo"); err == nil {
		lines := strings.Split(string(data), "\n")
		for _, line := range lines {
			if strings.HasPrefix(line, "MemTotal:") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					info.MemTotal, _ = strconv.ParseInt(fields[1], 10, 64)
				}
			}
			if strings.HasPrefix(line, "MemAvailable:") || strings.HasPrefix(line, "MemFree:") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					info.MemFree, _ = strconv.ParseInt(fields[1], 10, 64)
				}
			}
		}
	}

	// Check if Android
	if fileExists("/system/build.prop") {
		info.OS = "android"
	}

	return info, nil
}

// Close is a no-op for local client (no resources to clean up).
func (ldc *LocalDeviceClient) Close() error {
	return nil
}

func getArch() string {
	// Try to read from uname
	cmd := exec.Command("uname", "-m")
	if output, err := cmd.Output(); err == nil {
		return strings.TrimSpace(string(output))
	}
	return "unknown"
}
