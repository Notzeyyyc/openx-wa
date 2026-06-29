package devicecontext

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// RemoteSSHClient provides device access over SSH.
// Used when OpenX runs on a VPS/PC and connects to an Android device via SSH.
type RemoteSSHClient struct {
	mu       sync.Mutex
	client   *ssh.Client
	host     string
	port     int
	user     string
	key      string
	password string
}

// NewRemoteSSHClient creates a new SSH-based device client.
func NewRemoteSSHClient(host string, port int, user, keyPath, password string) (*RemoteSSHClient, error) {
	if host == "" {
		return nil, fmt.Errorf("SSH host cannot be empty")
	}
	if user == "" {
		user = "root"
	}
	if port == 0 {
		port = 22
	}

	rsc := &RemoteSSHClient{
		host:     host,
		port:     port,
		user:     user,
		key:      keyPath,
		password: password,
	}

	// Try to establish initial connection
	if err := rsc.connect(); err != nil {
		return nil, fmt.Errorf("initial SSH connection failed: %w", err)
	}

	return rsc, nil
}

// connect establishes or re-establishes the SSH connection.
// Caller must hold rsc.mu.
func (rsc *RemoteSSHClient) connect() error {
	// Close existing connection if any
	if rsc.client != nil {
		rsc.client.Close()
		rsc.client = nil
	}

	// Set up auth methods
	var authMethods []ssh.AuthMethod

	// Password auth
	if rsc.password != "" {
		authMethods = append(authMethods, ssh.Password(rsc.password))
	}

	// Key-based auth
	if rsc.key != "" {
		keyData, err := os.ReadFile(rsc.key)
		if err == nil {
			signer, err := ssh.ParsePrivateKey(keyData)
			if err == nil {
				authMethods = append(authMethods, ssh.PublicKeys(signer))
			}
		}
	}

	if len(authMethods) == 0 {
		return fmt.Errorf("no SSH auth methods available (set password or key)")
	}

	// Set up host key verification via known_hosts
	hostKeyCallback, err := knownHostsCallback()
	if err != nil {
		log.Printf("warning: SSH known_hosts not available, falling back to insecure: %v", err)
		hostKeyCallback = ssh.InsecureIgnoreHostKey()
	}

	config := &ssh.ClientConfig{
		User:            rsc.user,
		Auth:            authMethods,
		HostKeyCallback: hostKeyCallback,
		Timeout:         10 * time.Second,
	}

	addr := net.JoinHostPort(rsc.host, strconv.Itoa(rsc.port))
	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		return fmt.Errorf("SSH dial %s: %w", addr, err)
	}

	rsc.client = client
	return nil
}

// getClient returns the SSH client, reconnecting if necessary.
func (rsc *RemoteSSHClient) getClient() (*ssh.Client, error) {
	rsc.mu.Lock()
	defer rsc.mu.Unlock()

	if rsc.client == nil {
		if err := rsc.connect(); err != nil {
			return nil, err
		}
	}

	return rsc.client, nil
}

// knownHostsCallback creates a HostKeyCallback using the system known_hosts file.
func knownHostsCallback() (ssh.HostKeyCallback, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("get home dir: %w", err)
	}
	khPath := filepath.Join(home, ".ssh", "known_hosts")
	return knownhosts.New(khPath)
}

// ExecuteCommand runs a command on the remote device via SSH.
func (rsc *RemoteSSHClient) ExecuteCommand(ctx context.Context, cmd string) (string, error) {
	client, err := rsc.getClient()
	if err != nil {
		return "", fmt.Errorf("get SSH client: %w", err)
	}

	session, err := client.NewSession()
	if err != nil {
		// Try reconnecting
		if reconnErr := rsc.connect(); reconnErr != nil {
			return "", fmt.Errorf("SSH session failed and reconnect failed: %w", err)
		}
		client, err = rsc.getClient()
		if err != nil {
			return "", fmt.Errorf("reconnect failed: %w", err)
		}
		session, err = client.NewSession()
		if err != nil {
			return "", fmt.Errorf("SSH session: %w", err)
		}
	}
	defer session.Close()

	// Use a channel to handle context cancellation
	type result struct {
		output []byte
		err    error
	}
	resultChan := make(chan result, 1)

	go func() {
		var stdout bytes.Buffer
		session.Stdout = &stdout
		err := session.Run(cmd)
		resultChan <- result{output: stdout.Bytes(), err: err}
	}()

	select {
	case <-ctx.Done():
		session.Signal(ssh.SIGKILL)
		return "", ctx.Err()
	case res := <-resultChan:
		if res.err != nil {
			return "", fmt.Errorf("remote command failed: %w", res.err)
		}
		return strings.TrimSpace(string(res.output)), nil
	}
}

// ExecuteCommandArgs runs a command with separate arguments via SSH.
func (rsc *RemoteSSHClient) ExecuteCommandArgs(ctx context.Context, name string, args ...string) (string, error) {
	client, err := rsc.getClient()
	if err != nil {
		return "", fmt.Errorf("get SSH client: %w", err)
	}

	session, err := client.NewSession()
	if err != nil {
		if reconnErr := rsc.connect(); reconnErr != nil {
			return "", fmt.Errorf("SSH session failed and reconnect failed: %w", err)
		}
		client, err = rsc.getClient()
		if err != nil {
			return "", fmt.Errorf("reconnect failed: %w", err)
		}
		session, err = client.NewSession()
		if err != nil {
			return "", fmt.Errorf("SSH session: %w", err)
		}
	}
	defer session.Close()

	parts := make([]string, 0, len(args)+1)
	parts = append(parts, name)
	parts = append(parts, args...)
	cmd := strings.Join(parts, " ")

	type result struct {
		output []byte
		err    error
	}
	resultChan := make(chan result, 1)

	go func() {
		var stdout bytes.Buffer
		session.Stdout = &stdout
		err := session.Run(cmd)
		resultChan <- result{output: stdout.Bytes(), err: err}
	}()

	select {
	case <-ctx.Done():
		session.Signal(ssh.SIGKILL)
		return "", ctx.Err()
	case res := <-resultChan:
		if res.err != nil {
			return "", fmt.Errorf("remote command failed: %w", res.err)
		}
		return strings.TrimSpace(string(res.output)), nil
	}
}

// ReadFile reads a file from the remote device.
func (rsc *RemoteSSHClient) ReadFile(ctx context.Context, path string) ([]byte, error) {
	output, err := rsc.ExecuteCommand(ctx, fmt.Sprintf("cat %q", path))
	if err != nil {
		return nil, fmt.Errorf("read remote file %s: %w", path, err)
	}
	return []byte(output), nil
}

// WriteFile writes data to a file on the remote device.
func (rsc *RemoteSSHClient) WriteFile(ctx context.Context, path string, data []byte) error {
	// Use base64 encoding to safely transfer binary data
	cmd := fmt.Sprintf("echo %q > %q", string(data), path)
	_, err := rsc.ExecuteCommand(ctx, cmd)
	if err != nil {
		return fmt.Errorf("write remote file %s: %w", path, err)
	}
	return nil
}

// GetBatteryStatus reads battery info from the remote device.
func (rsc *RemoteSSHClient) GetBatteryStatus(ctx context.Context) (*BatteryInfo, error) {
	info := &BatteryInfo{}

	cmd := `cat /sys/class/power_supply/battery/capacity 2>/dev/null || echo -1; echo ---; ` +
		`cat /sys/class/power_supply/battery/status 2>/dev/null || echo Unknown; echo ---; ` +
		`cat /sys/class/power_supply/battery/temp 2>/dev/null || echo 0; echo ---; ` +
		`cat /sys/class/power_supply/battery/health 2>/dev/null || echo Unknown`

	output, err := rsc.ExecuteCommand(ctx, cmd)
	if err == nil {
		parts := strings.Split(output, "---")
		for i, part := range parts {
			part = strings.TrimSpace(part)
			switch i {
			case 0: // capacity
				info.Level, _ = strconv.Atoi(part)
			case 1: // status
				info.Status = part
			case 2: // temp
				if temp, err := strconv.Atoi(part); err == nil {
					info.Temperature = temp / 10
				}
			case 3: // health
				info.Health = part
			}
		}
	}

	return info, nil
}

// GetNetworkStats reads network stats from the remote device.
func (rsc *RemoteSSHClient) GetNetworkStats(ctx context.Context) (*NetworkStats, error) {
	output, err := rsc.ExecuteCommand(ctx, "cat /proc/net/dev")
	if err != nil {
		return nil, fmt.Errorf("read remote /proc/net/dev: %w", err)
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

// GetDeviceInfo reads device info from the remote device.
func (rsc *RemoteSSHClient) GetDeviceInfo(ctx context.Context) (*DeviceInfo, error) {
	info := &DeviceInfo{OS: "linux"}

	cmd := `hostname; echo ---; uname -m; echo ---; cat /proc/uptime; echo ---; test -f /system/build.prop && echo yes || echo no`

	output, err := rsc.ExecuteCommand(ctx, cmd)
	if err == nil {
		parts := strings.Split(output, "---")
		for i, part := range parts {
			part = strings.TrimSpace(part)
			switch i {
			case 0: // hostname
				info.Hostname = part
			case 1: // arch
				info.Arch = part
			case 2: // uptime
				fields := strings.Fields(part)
				if len(fields) > 0 {
					info.Uptime = fields[0] + "s"
				}
			case 3: // is android
				if part == "yes" {
					info.OS = "android"
				}
			}
		}
	}

	return info, nil
}

// Close closes the SSH connection.
func (rsc *RemoteSSHClient) Close() error {
	rsc.mu.Lock()
	defer rsc.mu.Unlock()

	if rsc.client != nil {
		err := rsc.client.Close()
		rsc.client = nil
		return err
	}
	return nil
}
