package core

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/notzeyyc/openx-v2/pkg/toolchain"
)

// Plugin is the base interface that all plugins must implement.
type Plugin interface {
	Name() string
	Register(server *mcp.Server)
}

// ChainablePlugin is an optional interface for plugins that want to register
// with the internal tool registry for use in chain_run operations.
type ChainablePlugin interface {
	Plugin
	RegisterToolchain(registry *toolchain.ToolRegistry) error
}

// ShutdownablePlugin is an optional interface for plugins that hold resources
// (goroutines, file handles, connections) and need cleanup on shutdown.
// This prevents memory leaks and resource exhaustion in long-running daemons.
type ShutdownablePlugin interface {
	Plugin
	Shutdown(ctx context.Context) error
}
