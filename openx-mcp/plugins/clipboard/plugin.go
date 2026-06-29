package clipboard

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/notzeyyc/openx-v2/config"
	"github.com/notzeyyc/openx-v2/pkg/devicecontext"
	"github.com/notzeyyc/openx-v2/pkg/toolchain"
)

type ClipboardPlugin struct {
	cfg      *config.Config
	dctx     *devicecontext.DeviceContext
	registry *toolchain.ToolRegistry
}

func New(cfg *config.Config, dctx *devicecontext.DeviceContext, registry *toolchain.ToolRegistry) *ClipboardPlugin {
	return &ClipboardPlugin{cfg: cfg, dctx: dctx, registry: registry}
}

func (p *ClipboardPlugin) Name() string {
	return "clipboard"
}

func (p *ClipboardPlugin) Register(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "clipboard_read",
		Description: "Read the current clipboard text using Termux API.",
	}, p.handleRead)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "clipboard_write",
		Description: "Write text into the Android clipboard using Termux API.",
	}, p.handleWrite)
}
