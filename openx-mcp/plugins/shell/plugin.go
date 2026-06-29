package shell

import (
	"context"
	"encoding/json"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/notzeyyc/openx-v2/config"
	"github.com/notzeyyc/openx-v2/pkg/toolchain"
)

// ShellPlugin provides shell command execution with proper timeout
// and output limiting to prevent process leaks and memory exhaustion.
type ShellPlugin struct {
	cfg      *config.Config
	registry *toolchain.ToolRegistry
}

func New(cfg *config.Config, registry *toolchain.ToolRegistry) *ShellPlugin {
	return &ShellPlugin{cfg: cfg, registry: registry}
}

func (p *ShellPlugin) Name() string {
	return "shell"
}

func (p *ShellPlugin) Register(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "shell_exec",
		Description: "Execute a shell command in the Android Termux environment. Commands have a default 30-second timeout.",
	}, p.handleExec)
}

func (p *ShellPlugin) RegisterToolchain(registry *toolchain.ToolRegistry) error {
	return registry.Register(
		"shell_exec",
		func(ctx context.Context, input json.RawMessage) (json.RawMessage, error) {
			var in ShellExecInput
			if err := json.Unmarshal(input, &in); err != nil {
				return nil, err
			}
			_, out, err := p.handleExec(ctx, nil, in)
			if err != nil {
				return nil, err
			}
			return json.Marshal(out)
		},
		"Execute a shell command in Termux",
	)
}
