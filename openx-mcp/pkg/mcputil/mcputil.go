package mcputil

import "github.com/modelcontextprotocol/go-sdk/mcp"

// TextResult creates an MCP CallToolResult containing a single text content block.
// This is the standard way to return text results from tool handlers.
func TextResult(message string) *mcp.CallToolResult {
	return &mcp.CallToolResult{
		Content: []mcp.Content{
			&mcp.TextContent{Text: message},
		},
	}
}
