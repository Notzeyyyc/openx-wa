package notification

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/notzeyyc/openx-v2/config"
	"github.com/notzeyyc/openx-v2/pkg/devicecontext"
	"github.com/notzeyyc/openx-v2/pkg/toolchain"
)

type NotificationPlugin struct {
	cfg      *config.Config
	dctx     *devicecontext.DeviceContext
	registry *toolchain.ToolRegistry
}

func New(cfg *config.Config, dctx *devicecontext.DeviceContext, registry *toolchain.ToolRegistry) *NotificationPlugin {
	return &NotificationPlugin{cfg: cfg, dctx: dctx, registry: registry}
}

func (p *NotificationPlugin) Name() string {
	return "notification"
}

func (p *NotificationPlugin) Register(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "notification_send",
		Description: "Send a local Android notification using Termux API.",
	}, p.handleSend)
}
