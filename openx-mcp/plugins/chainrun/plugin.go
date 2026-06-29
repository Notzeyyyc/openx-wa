package chainrun

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/notzeyyc/openx-v2/pkg/toolchain"
)

type ChainRunPlugin struct {
	registry *toolchain.ToolRegistry
}

func New(registry *toolchain.ToolRegistry) *ChainRunPlugin {
	return &ChainRunPlugin{
		registry: registry,
	}
}

func (p *ChainRunPlugin) Name() string {
	return "chainrun"
}

func (p *ChainRunPlugin) Register(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name: "chain_run",
		Description: "Execute multiple tools sequentially. Each step's output can be " +
			"used as input to the next step via {{step_X.output}} template references. " +
			"Returns detailed results including intermediate outputs, errors, and timings.",
	}, p.handleChainRun)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "chain_list_tools",
		Description: "List all available tools that can be used in a chain.",
	}, p.handleListTools)
}
