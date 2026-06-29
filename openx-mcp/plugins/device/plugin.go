package device

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/notzeyyc/openx-v2/config"
	"github.com/notzeyyc/openx-v2/pkg/devicecontext"
	"github.com/notzeyyc/openx-v2/pkg/toolchain"
)

type DevicePlugin struct {
	cfg      *config.Config
	dctx     *devicecontext.DeviceContext
	registry *toolchain.ToolRegistry
}

func New(cfg *config.Config, dctx *devicecontext.DeviceContext, registry *toolchain.ToolRegistry) *DevicePlugin {
	return &DevicePlugin{cfg: cfg, dctx: dctx, registry: registry}
}

func (p *DevicePlugin) Name() string {
	return "device"
}

func (p *DevicePlugin) Register(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "battery_status",
		Description: "Read the current device battery state and charge information.",
	}, p.handleBatteryStatus)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "network_stats",
		Description: "Inspect current network connectivity and traffic information.",
	}, p.handleNetworkStats)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "device_info",
		Description: "Return high-level Android device and environment details.",
	}, p.handleDeviceInfo)
}
