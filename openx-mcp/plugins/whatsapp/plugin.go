package whatsapp

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/notzeyyc/openx-v2/pkg/toolchain"
)

type WhatsAppPlugin struct {
	baileysURL string
	registry   *toolchain.ToolRegistry
}

func New(baileysURL string, registry *toolchain.ToolRegistry) *WhatsAppPlugin {
	return &WhatsAppPlugin{baileysURL: baileysURL, registry: registry}
}

func (p *WhatsAppPlugin) Name() string {
	return "whatsapp"
}

func (p *WhatsAppPlugin) Register(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "wa_send",
		Description: "Send a WhatsApp message through the Baileys bridge.",
	}, p.handleSend)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "wa_read",
		Description: "Read recent WhatsApp messages through the Baileys bridge.",
	}, p.handleRead)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "wa_reply",
		Description: "Reply to a WhatsApp message through the Baileys bridge.",
	}, p.handleReply)
}
