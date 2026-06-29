package whatsapp

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/notzeyyc/openx-v2/pkg/mcputil"
)

type WASendInput struct {
	ChatID  string `json:"chat_id" jsonschema:"chat or contact identifier"`
	Message string `json:"message" jsonschema:"message body to send"`
}

type WASendOutput struct {
	Message   string `json:"message" jsonschema:"status message for the send operation"`
	BridgeURL string `json:"bridge_url" jsonschema:"Baileys bridge base URL"`
	ChatID    string `json:"chat_id" jsonschema:"chat that was targeted"`
}

type WAReadInput struct {
	ChatID string `json:"chat_id,omitempty" jsonschema:"optional chat identifier to filter messages"`
	Limit  int    `json:"limit,omitempty" jsonschema:"maximum number of messages to return"`
}

type WAReadOutput struct {
	Message   string   `json:"message" jsonschema:"status message for the read operation"`
	BridgeURL string   `json:"bridge_url" jsonschema:"Baileys bridge base URL"`
	Messages  []string `json:"messages" jsonschema:"message summaries returned by the bridge"`
}

type WAReplyInput struct {
	ChatID    string `json:"chat_id" jsonschema:"chat or contact identifier"`
	MessageID string `json:"message_id" jsonschema:"message identifier being replied to"`
	Message   string `json:"message" jsonschema:"reply body to send"`
}

type WAReplyOutput struct {
	Message   string `json:"message" jsonschema:"status message for the reply operation"`
	BridgeURL string `json:"bridge_url" jsonschema:"Baileys bridge base URL"`
	ChatID    string `json:"chat_id" jsonschema:"chat that was targeted"`
}

func (p *WhatsAppPlugin) handleSend(_ context.Context, _ *mcp.CallToolRequest, in WASendInput) (*mcp.CallToolResult, WASendOutput, error) {
	message := "TODO: implement wa_send via HTTP to the Baileys bridge"
	out := WASendOutput{Message: message, BridgeURL: p.baileysURL, ChatID: in.ChatID}
	return 	mcputil.TextResult(message), out, nil
}

func (p *WhatsAppPlugin) handleRead(_ context.Context, _ *mcp.CallToolRequest, _ WAReadInput) (*mcp.CallToolResult, WAReadOutput, error) {
	message := "TODO: implement wa_read via HTTP to the Baileys bridge"
	out := WAReadOutput{Message: message, BridgeURL: p.baileysURL, Messages: []string{}}
	return 	mcputil.TextResult(message), out, nil
}

func (p *WhatsAppPlugin) handleReply(_ context.Context, _ *mcp.CallToolRequest, in WAReplyInput) (*mcp.CallToolResult, WAReplyOutput, error) {
	message := "TODO: implement wa_reply via HTTP to the Baileys bridge"
	out := WAReplyOutput{Message: message, BridgeURL: p.baileysURL, ChatID: in.ChatID}
	return 	mcputil.TextResult(message), out, nil
}
