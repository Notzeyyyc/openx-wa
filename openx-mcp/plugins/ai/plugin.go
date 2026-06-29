package ai

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/notzeyyc/openx-v2/config"
	"github.com/notzeyyc/openx-v2/pkg/toolchain"
)

type AIPlugin struct {
	cfg      config.AIConfig
	registry *toolchain.ToolRegistry
}

func New(cfg config.AIConfig, registry *toolchain.ToolRegistry) *AIPlugin {
	return &AIPlugin{cfg: cfg, registry: registry}
}

func (p *AIPlugin) Name() string {
	return "ai"
}

func (p *AIPlugin) Register(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "ai_query",
		Description: "Send a prompt to the configured AI provider and return the response.",
	}, p.handleQuery)
}
