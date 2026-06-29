package device

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/notzeyyc/openx-v2/pkg/mcputil"
)

type EmptyInput struct{}

type BatteryStatusOutput struct {
	Message     string `json:"message" jsonschema:"status message for the battery query"`
	Level       int    `json:"level" jsonschema:"battery percentage if known"`
	Charging    bool   `json:"charging" jsonschema:"whether the device is charging"`
	Status      string `json:"status" jsonschema:"battery status string"`
	Temperature int    `json:"temperature" jsonschema:"battery temperature in celsius"`
	Source      string `json:"source" jsonschema:"data source or backend used"`
}

type NetworkStatsOutput struct {
	Message    string `json:"message" jsonschema:"status message for the network query"`
	Connection string `json:"connection" jsonschema:"active connection type if known"`
	RxBytes    int64  `json:"rx_bytes" jsonschema:"received bytes if known"`
	TxBytes    int64  `json:"tx_bytes" jsonschema:"transmitted bytes if known"`
	Interface  string `json:"interface" jsonschema:"network interface name"`
}

type DeviceInfoOutput struct {
	Message  string `json:"message" jsonschema:"status message for the device info query"`
	Hostname string `json:"hostname" jsonschema:"device hostname if known"`
	OS       string `json:"os" jsonschema:"operating system name"`
	Arch     string `json:"arch" jsonschema:"cpu architecture"`
	Uptime   string `json:"uptime" jsonschema:"device uptime"`
	MemTotal int64  `json:"mem_total_kb" jsonschema:"total memory in KB"`
	MemFree  int64  `json:"mem_free_kb" jsonschema:"free memory in KB"`
}

func (p *DevicePlugin) handleBatteryStatus(ctx context.Context, _ *mcp.CallToolRequest, _ EmptyInput) (*mcp.CallToolResult, BatteryStatusOutput, error) {
	if p.dctx == nil || p.dctx.Client == nil {
		message := "device context not available"
		return mcputil.TextResult(message), BatteryStatusOutput{Message: message}, nil
	}

	info, err := p.dctx.Client.GetBatteryStatus(ctx)
	if err != nil {
		message := fmt.Sprintf("failed to get battery status: %v", err)
		return mcputil.TextResult(message), BatteryStatusOutput{Message: message, Source: string(p.dctx.Mode)}, nil
	}

	charging := info.Status == "Charging" || info.Status == "Full"
	message := fmt.Sprintf("Battery: %d%%, Status: %s, Temp: %d°C", info.Level, info.Status, info.Temperature)

	out := BatteryStatusOutput{
		Message:     message,
		Level:       info.Level,
		Charging:    charging,
		Status:      info.Status,
		Temperature: info.Temperature,
		Source:      string(p.dctx.Mode),
	}

	return mcputil.TextResult(message), out, nil
}

func (p *DevicePlugin) handleNetworkStats(ctx context.Context, _ *mcp.CallToolRequest, _ EmptyInput) (*mcp.CallToolResult, NetworkStatsOutput, error) {
	if p.dctx == nil || p.dctx.Client == nil {
		message := "device context not available"
		return mcputil.TextResult(message), NetworkStatsOutput{Message: message}, nil
	}

	stats, err := p.dctx.Client.GetNetworkStats(ctx)
	if err != nil {
		message := fmt.Sprintf("failed to get network stats: %v", err)
		return mcputil.TextResult(message), NetworkStatsOutput{Message: message}, nil
	}

	message := fmt.Sprintf("Network: %s (%s), RX: %d bytes, TX: %d bytes",
		stats.Connection, stats.Interface, stats.RxBytes, stats.TxBytes)

	out := NetworkStatsOutput{
		Message:    message,
		Connection: stats.Connection,
		RxBytes:    stats.RxBytes,
		TxBytes:    stats.TxBytes,
		Interface:  stats.Interface,
	}

	return mcputil.TextResult(message), out, nil
}

func (p *DevicePlugin) handleDeviceInfo(ctx context.Context, _ *mcp.CallToolRequest, _ EmptyInput) (*mcp.CallToolResult, DeviceInfoOutput, error) {
	if p.dctx == nil || p.dctx.Client == nil {
		message := "device context not available"
		return mcputil.TextResult(message), DeviceInfoOutput{Message: message}, nil
	}

	info, err := p.dctx.Client.GetDeviceInfo(ctx)
	if err != nil {
		message := fmt.Sprintf("failed to get device info: %v", err)
		return mcputil.TextResult(message), DeviceInfoOutput{Message: message}, nil
	}

	message := fmt.Sprintf("Device: %s, OS: %s, Arch: %s, Uptime: %s, Mem: %dKB/%dKB",
		info.Hostname, info.OS, info.Arch, info.Uptime, info.MemFree, info.MemTotal)

	out := DeviceInfoOutput{
		Message:  message,
		Hostname: info.Hostname,
		OS:       info.OS,
		Arch:     info.Arch,
		Uptime:   info.Uptime,
		MemTotal: info.MemTotal,
		MemFree:  info.MemFree,
	}

	return mcputil.TextResult(message), out, nil
}
