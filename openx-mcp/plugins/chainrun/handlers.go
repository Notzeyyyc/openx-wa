package chainrun

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/notzeyyc/openx-v2/pkg/mcputil"
	"github.com/notzeyyc/openx-v2/pkg/toolchain"
)

type ChainRunInput struct {
	Steps       []toolchain.ChainStep `json:"steps" jsonschema:"array of steps to execute sequentially"`
	StopOnError bool                  `json:"stop_on_error,omitempty" jsonschema:"whether to stop on first error (default: false, continue to collect all results)"`
	Timeout     int                   `json:"timeout_seconds,omitempty" jsonschema:"optional timeout for entire chain in seconds (default: 60)"`
}

type ChainRunOutput struct {
	Message      string                      `json:"message" jsonschema:"status message"`
	Success      bool                        `json:"success" jsonschema:"true if all steps succeeded"`
	StepsCount   int                         `json:"steps_count" jsonschema:"total number of steps"`
	SuccessCount int                         `json:"success_count" jsonschema:"number of successful steps"`
	ErrorCount   int                         `json:"error_count" jsonschema:"number of failed steps"`
	Results      []toolchain.ChainStepResult `json:"results" jsonschema:"detailed results for each step"`
	TotalDuration float64                    `json:"total_duration_ms" jsonschema:"total execution time in milliseconds"`
}

type ListToolsOutput struct {
	Message   string   `json:"message" jsonschema:"status message"`
	ToolCount int      `json:"tool_count" jsonschema:"number of available tools"`
	Tools     []string `json:"tools" jsonschema:"list of available tool names"`
}

func (p *ChainRunPlugin) handleChainRun(ctx context.Context, _ *mcp.CallToolRequest, in ChainRunInput) (*mcp.CallToolResult, ChainRunOutput, error) {
	startTime := time.Now()
	out := ChainRunOutput{
		Message: "Chain execution started",
	}

	// Validate input
	if len(in.Steps) == 0 {
		out.Message = "No steps provided"
		return mcputil.TextResult(out.Message), out, nil
	}

	// Set timeout
	timeout := time.Duration(60) * time.Second // default 60s
	if in.Timeout > 0 {
		timeout = time.Duration(in.Timeout) * time.Second
	}

	chainCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// Execute the chain
	results, err := p.registry.RunChain(chainCtx, in.Steps, in.StopOnError)

	out.StepsCount = len(in.Steps)
	out.Results = results

	// Count successes and errors
	successCount := 0
	errorCount := 0
	for _, result := range results {
		if result.Success {
			successCount++
		} else {
			errorCount++
		}
		// Accumulate individual step timings if available
		out.TotalDuration += result.Duration
	}

	out.SuccessCount = successCount
	out.ErrorCount = errorCount
	out.Success = errorCount == 0
	out.TotalDuration += float64(time.Since(startTime).Milliseconds())

	if err != nil {
		out.Message = fmt.Sprintf("Chain execution failed: %v", err)
		return mcputil.TextResult(out.Message), out, err
	}

	if out.Success {
		out.Message = fmt.Sprintf("Chain completed successfully: %d/%d steps succeeded", successCount, len(in.Steps))
	} else {
		out.Message = fmt.Sprintf("Chain partially completed: %d/%d steps succeeded, %d failed", successCount, len(in.Steps), errorCount)
	}

	return mcputil.TextResult(out.Message), out, nil
}

func (p *ChainRunPlugin) handleListTools(_ context.Context, _ *mcp.CallToolRequest, _ interface{}) (*mcp.CallToolResult, ListToolsOutput, error) {
	tools := p.registry.List()
	out := ListToolsOutput{
		Message:   fmt.Sprintf("Found %d available tools", len(tools)),
		ToolCount: len(tools),
		Tools:     tools,
	}
	return mcputil.TextResult(out.Message), out, nil
}

// ToJSON converts the output to JSON for debugging
func (out ChainRunOutput) ToJSON() []byte {
	data, _ := json.MarshalIndent(out, "", "  ")
	return data
}
