package memory

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/notzeyyc/openx-v2/pkg/mcputil"
)

// Input/Output types for memory tools

type MemorySetInput struct {
	Key   string      `json:"key" jsonschema:"the key to store the value under"`
	Value interface{} `json:"value" jsonschema:"the value to store (any JSON-serializable type)"`
}

type MemorySetOutput struct {
	Message string `json:"message" jsonschema:"status message"`
	Key     string `json:"key" jsonschema:"the key that was stored"`
	Success bool   `json:"success" jsonschema:"whether the operation succeeded"`
}

type MemoryGetInput struct {
	Key string `json:"key" jsonschema:"the key to retrieve"`
}

type MemoryGetOutput struct {
	Message string      `json:"message" jsonschema:"status message"`
	Key     string      `json:"key" jsonschema:"the key that was retrieved"`
	Value   interface{} `json:"value" jsonschema:"the stored value"`
	Found   bool        `json:"found" jsonschema:"whether the key was found"`
}

type MemoryListInput struct {
	Pattern string `json:"pattern,omitempty" jsonschema:"glob pattern to match keys (default: * for all)"`
}

type MemoryListOutput struct {
	Message string   `json:"message" jsonschema:"status message"`
	Keys    []string `json:"keys" jsonschema:"list of matching keys"`
	Count   int      `json:"count" jsonschema:"number of matching keys"`
}

type MemoryDeleteInput struct {
	Key string `json:"key" jsonschema:"the key to delete"`
}

type MemoryDeleteOutput struct {
	Message string `json:"message" jsonschema:"status message"`
	Key     string `json:"key" jsonschema:"the key that was requested for deletion"`
	Deleted bool   `json:"deleted" jsonschema:"whether the key was found and deleted"`
}

type MemoryClearInput struct{}

type MemoryClearOutput struct {
	Message string `json:"message" jsonschema:"status message"`
	Success bool   `json:"success" jsonschema:"whether the clear operation succeeded"`
}

// Handler implementations

func (p *MemoryPlugin) handleSet(_ context.Context, _ *mcp.CallToolRequest, in MemorySetInput) (*mcp.CallToolResult, MemorySetOutput, error) {
	if in.Key == "" {
		msg := "key cannot be empty"
		return mcputil.TextResult(msg), MemorySetOutput{Message: msg, Success: false}, nil
	}

	if err := p.storage.Set(in.Key, in.Value); err != nil {
		msg := fmt.Sprintf("failed to set key %q: %v", in.Key, err)
		p.logger.Error(msg)
		return mcputil.TextResult(msg), MemorySetOutput{Message: msg, Key: in.Key, Success: false}, nil
	}

	msg := fmt.Sprintf("stored key %q successfully", in.Key)
	return mcputil.TextResult(msg), MemorySetOutput{Message: msg, Key: in.Key, Success: true}, nil
}

func (p *MemoryPlugin) handleGet(_ context.Context, _ *mcp.CallToolRequest, in MemoryGetInput) (*mcp.CallToolResult, MemoryGetOutput, error) {
	if in.Key == "" {
		msg := "key cannot be empty"
		return mcputil.TextResult(msg), MemoryGetOutput{Message: msg, Found: false}, nil
	}

	value, found, err := p.storage.Get(in.Key)
	if err != nil {
		msg := fmt.Sprintf("failed to get key %q: %v", in.Key, err)
		p.logger.Error(msg)
		return mcputil.TextResult(msg), MemoryGetOutput{Message: msg, Key: in.Key, Found: false}, nil
	}

	if !found {
		msg := fmt.Sprintf("key %q not found", in.Key)
		return mcputil.TextResult(msg), MemoryGetOutput{Message: msg, Key: in.Key, Found: false}, nil
	}

	msg := fmt.Sprintf("retrieved key %q", in.Key)
	return mcputil.TextResult(msg), MemoryGetOutput{Message: msg, Key: in.Key, Value: value, Found: true}, nil
}

func (p *MemoryPlugin) handleList(_ context.Context, _ *mcp.CallToolRequest, in MemoryListInput) (*mcp.CallToolResult, MemoryListOutput, error) {
	pattern := in.Pattern
	if pattern == "" {
		pattern = "*"
	}

	keys, err := p.storage.List(pattern)
	if err != nil {
		msg := fmt.Sprintf("failed to list keys: %v", err)
		p.logger.Error(msg)
		return mcputil.TextResult(msg), MemoryListOutput{Message: msg, Keys: []string{}, Count: 0}, nil
	}

	if keys == nil {
		keys = []string{}
	}

	msg := fmt.Sprintf("found %d keys matching pattern %q", len(keys), pattern)
	return mcputil.TextResult(msg), MemoryListOutput{Message: msg, Keys: keys, Count: len(keys)}, nil
}

func (p *MemoryPlugin) handleDelete(_ context.Context, _ *mcp.CallToolRequest, in MemoryDeleteInput) (*mcp.CallToolResult, MemoryDeleteOutput, error) {
	if in.Key == "" {
		msg := "key cannot be empty"
		return mcputil.TextResult(msg), MemoryDeleteOutput{Message: msg, Deleted: false}, nil
	}

	deleted, err := p.storage.Delete(in.Key)
	if err != nil {
		msg := fmt.Sprintf("failed to delete key %q: %v", in.Key, err)
		p.logger.Error(msg)
		return mcputil.TextResult(msg), MemoryDeleteOutput{Message: msg, Key: in.Key, Deleted: false}, nil
	}

	if !deleted {
		msg := fmt.Sprintf("key %q not found", in.Key)
		return mcputil.TextResult(msg), MemoryDeleteOutput{Message: msg, Key: in.Key, Deleted: false}, nil
	}

	msg := fmt.Sprintf("deleted key %q", in.Key)
	return mcputil.TextResult(msg), MemoryDeleteOutput{Message: msg, Key: in.Key, Deleted: true}, nil
}

func (p *MemoryPlugin) handleClear(_ context.Context, _ *mcp.CallToolRequest, _ MemoryClearInput) (*mcp.CallToolResult, MemoryClearOutput, error) {
	if err := p.storage.Clear(); err != nil {
		msg := fmt.Sprintf("failed to clear memory: %v", err)
		p.logger.Error(msg)
		return mcputil.TextResult(msg), MemoryClearOutput{Message: msg, Success: false}, nil
	}

	msg := "memory cleared successfully"
	return mcputil.TextResult(msg), MemoryClearOutput{Message: msg, Success: true}, nil
}
