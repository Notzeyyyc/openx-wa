package clipboard

import (
	"context"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/notzeyyc/openx-v2/pkg/mcputil"
)

type ClipboardReadInput struct{}

type ClipboardReadOutput struct {
	Message string `json:"message" jsonschema:"status message for the clipboard read"`
	Text    string `json:"text" jsonschema:"clipboard text when available"`
}

type ClipboardWriteInput struct {
	Text string `json:"text" jsonschema:"text to place into the clipboard"`
}

type ClipboardWriteOutput struct {
	Message string `json:"message" jsonschema:"status message for the clipboard write"`
	Bytes   int    `json:"bytes" jsonschema:"number of bytes accepted for writing"`
}

func (p *ClipboardPlugin) handleRead(ctx context.Context, _ *mcp.CallToolRequest, _ ClipboardReadInput) (*mcp.CallToolResult, ClipboardReadOutput, error) {
	if p.cfg.Dev.MockDevice {
		out := ClipboardReadOutput{Message: "Success (mock)", Text: "mock clipboard content"}
		return mcputil.TextResult("Mock clipboard content"), out, nil
	}

	output, err := p.dctx.Client.ExecuteCommand(ctx, "termux-clipboard-get")
	if err != nil {
		msg := fmt.Sprintf("clipboard read failed: %v", err)
		return mcputil.TextResult(msg), ClipboardReadOutput{Message: msg}, nil
	}

	text := strings.TrimSpace(output)
	return mcputil.TextResult(text), ClipboardReadOutput{Message: "success", Text: text}, nil
}

func (p *ClipboardPlugin) handleWrite(ctx context.Context, _ *mcp.CallToolRequest, in ClipboardWriteInput) (*mcp.CallToolResult, ClipboardWriteOutput, error) {
	if p.cfg.Dev.MockDevice {
		out := ClipboardWriteOutput{Message: "Success (mock)", Bytes: len(in.Text)}
		return mcputil.TextResult("Mock clipboard write: "+in.Text), out, nil
	}

	_, err := p.dctx.Client.ExecuteCommandArgs(ctx, "termux-clipboard-set", in.Text)
	if err != nil {
		msg := fmt.Sprintf("clipboard write failed: %v", err)
		return mcputil.TextResult(msg), ClipboardWriteOutput{Message: msg}, nil
	}

	out := ClipboardWriteOutput{Message: "success", Bytes: len(in.Text)}
	return mcputil.TextResult(fmt.Sprintf("wrote %d bytes to clipboard", len(in.Text))), out, nil
}
