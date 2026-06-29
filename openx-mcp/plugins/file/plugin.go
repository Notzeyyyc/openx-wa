package fileplugin

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/notzeyyc/openx-v2/pkg/devicecontext"
	"github.com/notzeyyc/openx-v2/pkg/toolchain"
)

type FilePlugin struct {
	dctx    *devicecontext.DeviceContext
	registry *toolchain.ToolRegistry
}

func New(dctx *devicecontext.DeviceContext, registry *toolchain.ToolRegistry) *FilePlugin {
	return &FilePlugin{dctx: dctx, registry: registry}
}

func (p *FilePlugin) Name() string {
	return "file"
}

func (p *FilePlugin) Register(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "file_read",
		Description: "Read a text file from device storage.",
	}, p.handleRead)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "file_write",
		Description: "Write text content to a file on device storage.",
	}, p.handleWrite)
}
