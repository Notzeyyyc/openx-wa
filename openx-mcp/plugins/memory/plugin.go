package memory

import (
	"context"
	"encoding/json"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/notzeyyc/openx-v2/config"
	"github.com/notzeyyc/openx-v2/pkg/logging"
	pkgmemory "github.com/notzeyyc/openx-v2/pkg/memory"
	"github.com/notzeyyc/openx-v2/pkg/toolchain"
)

// MemoryPlugin provides persistent key-value storage for the AI.
type MemoryPlugin struct {
	storage  *pkgmemory.MemoryStorage
	registry *toolchain.ToolRegistry
	logger   *logging.Logger
}

// New creates a new MemoryPlugin instance.
func New(cfg *config.Config, registry *toolchain.ToolRegistry) (*MemoryPlugin, error) {
	storage, err := pkgmemory.NewMemoryStorage(
		cfg.Memory.StoragePath,
		cfg.Memory.MaxSizeBytes,
		cfg.Memory.AutoBackup,
		cfg.Memory.BackupCount,
	)
	if err != nil {
		return nil, err
	}

	return &MemoryPlugin{
		storage:  storage,
		registry: registry,
		logger:   logging.GetLogger("memory"),
	}, nil
}

// Name returns the plugin name.
func (p *MemoryPlugin) Name() string {
	return "memory"
}

// Register registers MCP tools with the server.
func (p *MemoryPlugin) Register(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "memory_set",
		Description: "Store a key-value pair in persistent memory. Values are serialized as JSON.",
	}, p.handleSet)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "memory_get",
		Description: "Retrieve a value from persistent memory by key.",
	}, p.handleGet)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "memory_list",
		Description: "List all keys in persistent memory matching a glob pattern. Use * for all keys.",
	}, p.handleList)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "memory_delete",
		Description: "Delete a key from persistent memory.",
	}, p.handleDelete)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "memory_clear",
		Description: "Clear all data from persistent memory. This action is irreversible.",
	}, p.handleClear)
}

// RegisterToolchain registers memory tools with the internal tool registry for chaining.
func (p *MemoryPlugin) RegisterToolchain(registry *toolchain.ToolRegistry) error {
	handlers := map[string]struct {
		fn   func(ctx context.Context, input json.RawMessage) (json.RawMessage, error)
		desc string
	}{
		"memory_set": {
			fn:   p.chainHandleSet,
			desc: "Store a key-value pair in persistent memory",
		},
		"memory_get": {
			fn:   p.chainHandleGet,
			desc: "Retrieve a value from persistent memory",
		},
		"memory_list": {
			fn:   p.chainHandleList,
			desc: "List keys matching a glob pattern",
		},
		"memory_delete": {
			fn:   p.chainHandleDelete,
			desc: "Delete a key from persistent memory",
		},
		"memory_clear": {
			fn:   p.chainHandleClear,
			desc: "Clear all persistent memory data",
		},
	}

	for name, h := range handlers {
		if err := registry.Register(name, h.fn, h.desc); err != nil {
			return err
		}
	}

	return nil
}

// Shutdown performs cleanup on plugin shutdown.
func (p *MemoryPlugin) Shutdown(ctx context.Context) error {
	p.logger.Info("shutting down memory plugin")
	if p.storage != nil {
		return p.storage.Close()
	}
	return nil
}

// Chain handler wrappers for toolchain integration
func (p *MemoryPlugin) chainHandleSet(ctx context.Context, input json.RawMessage) (json.RawMessage, error) {
	var in MemorySetInput
	if err := json.Unmarshal(input, &in); err != nil {
		return nil, err
	}
	_, out, err := p.handleSet(ctx, nil, in)
	if err != nil {
		return nil, err
	}
	return json.Marshal(out)
}

func (p *MemoryPlugin) chainHandleGet(ctx context.Context, input json.RawMessage) (json.RawMessage, error) {
	var in MemoryGetInput
	if err := json.Unmarshal(input, &in); err != nil {
		return nil, err
	}
	_, out, err := p.handleGet(ctx, nil, in)
	if err != nil {
		return nil, err
	}
	return json.Marshal(out)
}

func (p *MemoryPlugin) chainHandleList(ctx context.Context, input json.RawMessage) (json.RawMessage, error) {
	var in MemoryListInput
	if err := json.Unmarshal(input, &in); err != nil {
		return nil, err
	}
	_, out, err := p.handleList(ctx, nil, in)
	if err != nil {
		return nil, err
	}
	return json.Marshal(out)
}

func (p *MemoryPlugin) chainHandleDelete(ctx context.Context, input json.RawMessage) (json.RawMessage, error) {
	var in MemoryDeleteInput
	if err := json.Unmarshal(input, &in); err != nil {
		return nil, err
	}
	_, out, err := p.handleDelete(ctx, nil, in)
	if err != nil {
		return nil, err
	}
	return json.Marshal(out)
}

func (p *MemoryPlugin) chainHandleClear(ctx context.Context, input json.RawMessage) (json.RawMessage, error) {
	var in MemoryClearInput
	if err := json.Unmarshal(input, &in); err != nil {
		return nil, err
	}
	_, out, err := p.handleClear(ctx, nil, in)
	if err != nil {
		return nil, err
	}
	return json.Marshal(out)
}
