package fileplugin

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/notzeyyc/openx-v2/pkg/mcputil"
)

func sanitizePath(p string) (string, error) {
	cleaned := filepath.Clean(p)
	if strings.HasPrefix(cleaned, "..") || strings.Contains(cleaned, "..") {
		return "", fmt.Errorf("path traversal not allowed")
	}
	return cleaned, nil
}

type FileReadInput struct {
	Path string `json:"path" jsonschema:"absolute or relative file path to read"`
}

type FileReadOutput struct {
	Message string `json:"message" jsonschema:"status message for the read operation"`
	Path    string `json:"path" jsonschema:"path that was requested"`
	Content string `json:"content" jsonschema:"file contents when available"`
}

type FileWriteInput struct {
	Path       string `json:"path" jsonschema:"absolute or relative file path to write"`
	Content    string `json:"content" jsonschema:"text content to write to the file"`
	CreateDirs bool   `json:"create_dirs,omitempty" jsonschema:"create parent directories when needed"`
}

type FileWriteOutput struct {
	Message string `json:"message" jsonschema:"status message for the write operation"`
	Path    string `json:"path" jsonschema:"path that was requested"`
	Bytes   int    `json:"bytes" jsonschema:"number of bytes written when available"`
}

func (p *FilePlugin) handleRead(ctx context.Context, _ *mcp.CallToolRequest, in FileReadInput) (*mcp.CallToolResult, FileReadOutput, error) {
	if in.Path == "" {
		msg := "path is required"
		return mcputil.TextResult(msg), FileReadOutput{Message: msg, Path: in.Path}, nil
	}

	cleaned, err := sanitizePath(in.Path)
	if err != nil {
		return mcputil.TextResult(err.Error()), FileReadOutput{Message: err.Error(), Path: in.Path}, nil
	}

	data, err := p.dctx.Client.ReadFile(ctx, cleaned)
	if err != nil {
		msg := fmt.Sprintf("failed to read %s: %v", cleaned, err)
		return mcputil.TextResult(msg), FileReadOutput{Message: msg, Path: cleaned}, nil
	}

	content := string(data)
	// Truncate very large files
	const maxDisplay = 100 * 1024 // 100KB
	if len(content) > maxDisplay {
		content = content[:maxDisplay] + fmt.Sprintf("\n... (truncated, %d bytes total)", len(data))
	}

	msg := fmt.Sprintf("read %d bytes from %s", len(data), cleaned)
	return mcputil.TextResult(content), FileReadOutput{
		Message: msg,
		Path:    cleaned,
		Content: string(data),
	}, nil
}

func (p *FilePlugin) handleWrite(ctx context.Context, _ *mcp.CallToolRequest, in FileWriteInput) (*mcp.CallToolResult, FileWriteOutput, error) {
	if in.Path == "" {
		msg := "path is required"
		return mcputil.TextResult(msg), FileWriteOutput{Message: msg, Path: in.Path}, nil
	}

	cleaned, err := sanitizePath(in.Path)
	if err != nil {
		return mcputil.TextResult(err.Error()), FileWriteOutput{Message: err.Error(), Path: in.Path}, nil
	}

	// Create directories if requested
	if in.CreateDirs {
		dir := filepath.Dir(cleaned)
		if dir != "" {
			_, _ = p.dctx.Client.ExecuteCommand(ctx, fmt.Sprintf("mkdir -p %q", dir))
		}
	}

	err = p.dctx.Client.WriteFile(ctx, cleaned, []byte(in.Content))
	if err != nil {
		msg := fmt.Sprintf("failed to write %s: %v", cleaned, err)
		return mcputil.TextResult(msg), FileWriteOutput{Message: msg, Path: cleaned}, nil
	}

	msg := fmt.Sprintf("wrote %d bytes to %s", len(in.Content), cleaned)
	return mcputil.TextResult(msg), FileWriteOutput{
		Message: msg,
		Path:    cleaned,
		Bytes:   len(in.Content),
	}, nil
}
