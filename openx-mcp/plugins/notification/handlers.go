package notification

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/notzeyyc/openx-v2/pkg/mcputil"
)

type NotificationSendInput struct {
	Title   string `json:"title" jsonschema:"notification title"`
	Content string `json:"content" jsonschema:"notification body content"`
	ID      int    `json:"id,omitempty" jsonschema:"optional notification identifier"`
}

type NotificationSendOutput struct {
	Message string `json:"message" jsonschema:"status message for the notification send"`
	Title   string `json:"title" jsonschema:"title that was requested"`
}

func (p *NotificationPlugin) handleSend(ctx context.Context, _ *mcp.CallToolRequest, in NotificationSendInput) (*mcp.CallToolResult, NotificationSendOutput, error) {
	if p.cfg.Dev.MockDevice {
		message := fmt.Sprintf("Mock notification sent to stdout: [%s] %s", in.Title, in.Content)
		fmt.Println(message)
		out := NotificationSendOutput{Message: "Success (mock)", Title: in.Title}
		return mcputil.TextResult(message), out, nil
	}

	args := []string{"--title", in.Title, "--content", in.Content}
	if in.ID > 0 {
		args = append(args, "--id", fmt.Sprintf("%d", in.ID))
	}

	_, err := p.dctx.Client.ExecuteCommandArgs(ctx, "termux-notification", args...)
	if err != nil {
		msg := fmt.Sprintf("notification send failed: %v", err)
		return mcputil.TextResult(msg), NotificationSendOutput{Message: msg, Title: in.Title}, nil
	}

	msg := fmt.Sprintf("notification sent: %s", in.Title)
	out := NotificationSendOutput{Message: "success", Title: in.Title}
	return mcputil.TextResult(msg), out, nil
}
