package toolchain

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sync"
	"time"
)

var (
	templateRefRegex = regexp.MustCompile(`\{\{(step_\d+)\.output\}\}`)
	stepKeyRegex     = regexp.MustCompile(`step_(\d+)`)
)

// ToolHandler is the signature for a tool's execution function.
// It takes context and input JSON, returns output JSON and error.
type ToolHandler func(ctx context.Context, input json.RawMessage) (json.RawMessage, error)

// Tool represents a registered tool in the chain.
type Tool struct {
	Name        string
	Handler     ToolHandler
	Description string
}

// ChainStep defines a single step in a chain execution.
type ChainStep struct {
	StepID      string          `json:"step_id"`      // unique identifier (e.g., "step_0", "step_1")
	ToolName    string          `json:"tool_name"`    // tool to execute
	Input       json.RawMessage `json:"input"`        // input JSON (may contain {{step_X.output}} references)
	Description string          `json:"description"` // human-readable description
}

// ChainStepResult holds the result of a single step.
type ChainStepResult struct {
	StepID    string          `json:"step_id"`
	ToolName  string          `json:"tool_name"`
	Input     json.RawMessage `json:"input"`
	Output    json.RawMessage `json:"output"`
	Error     string          `json:"error,omitempty"`
	Success   bool            `json:"success"`
	Duration  float64         `json:"duration_ms"` // milliseconds
}

// ToolRegistry manages tool registration and execution.
type ToolRegistry struct {
	mu    sync.RWMutex
	tools map[string]*Tool
}

// NewToolRegistry creates a new tool registry.
func NewToolRegistry() *ToolRegistry {
	return &ToolRegistry{
		tools: make(map[string]*Tool),
	}
}

// Register adds a tool to the registry.
func (tr *ToolRegistry) Register(name string, handler ToolHandler, description string) error {
	if name == "" {
		return fmt.Errorf("tool name cannot be empty")
	}
	if handler == nil {
		return fmt.Errorf("tool handler cannot be nil")
	}

	tr.mu.Lock()
	defer tr.mu.Unlock()

	if _, exists := tr.tools[name]; exists {
		return fmt.Errorf("tool %q already registered", name)
	}

	tr.tools[name] = &Tool{
		Name:        name,
		Handler:     handler,
		Description: description,
	}
	return nil
}

// List returns all registered tool names.
func (tr *ToolRegistry) List() []string {
	tr.mu.RLock()
	defer tr.mu.RUnlock()

	names := make([]string, 0, len(tr.tools))
	for name := range tr.tools {
		names = append(names, name)
	}
	return names
}

// Execute runs a single tool with the given input.
func (tr *ToolRegistry) Execute(ctx context.Context, toolName string, input json.RawMessage) (json.RawMessage, error) {
	tr.mu.RLock()
	tool, exists := tr.tools[toolName]
	tr.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("tool %q not found", toolName)
	}

	return tool.Handler(ctx, input)
}

// RunChain executes a sequence of tools, passing output from one step as input to the next.
// Supports template syntax {{step_N.output}} to reference previous results.
func (tr *ToolRegistry) RunChain(ctx context.Context, steps []ChainStep, stopOnError bool) ([]ChainStepResult, error) {
	if len(steps) == 0 {
		return []ChainStepResult{}, nil
	}

	results := make([]ChainStepResult, 0, len(steps))
	stepOutputs := make(map[string]json.RawMessage)

	for _, step := range steps {
		select {
		case <-ctx.Done():
			return results, ctx.Err()
		default:
		}

		stepStart := time.Now()

		// Resolve template references in input
		resolvedInput, err := resolveTemplates(step.Input, stepOutputs)
		if err != nil {
			results = append(results, ChainStepResult{
				StepID:   step.StepID,
				ToolName: step.ToolName,
				Input:    step.Input,
				Error:    fmt.Sprintf("template resolution failed: %v", err),
				Success:  false,
				Duration: float64(time.Since(stepStart).Milliseconds()),
			})
			if stopOnError {
				return results, fmt.Errorf("step %s failed: template resolution failed", step.StepID)
			}
			continue
		}

		// Execute the tool
		output, err := tr.Execute(ctx, step.ToolName, resolvedInput)
		duration := float64(time.Since(stepStart).Milliseconds())
		stepResult := ChainStepResult{
			StepID:   step.StepID,
			ToolName: step.ToolName,
			Input:    resolvedInput,
			Output:   output,
			Success:  err == nil,
			Duration: duration,
		}

		if err != nil {
			stepResult.Error = err.Error()
		}

		results = append(results, stepResult)
		stepOutputs[step.StepID] = output

		if !stepResult.Success && stopOnError {
			return results, fmt.Errorf("step %s failed: %s", step.StepID, stepResult.Error)
		}
	}

	return results, nil
}

// resolveTemplates replaces {{step_X.output}} references with actual step outputs.
// It converts JSON to a flattened structure for easy templating.
func resolveTemplates(input json.RawMessage, outputs map[string]json.RawMessage) (json.RawMessage, error) {
	inputStr := string(input)

	matches := templateRefRegex.FindAllStringSubmatch(inputStr, -1)

	for _, match := range matches {
		stepID := match[1]
		output, exists := outputs[stepID]
		if !exists {
			return nil, fmt.Errorf("reference to undefined step: %s", stepID)
		}
		placeholderRe := regexp.MustCompile(regexp.QuoteMeta(match[0]))
		inputStr = placeholderRe.ReplaceAllString(inputStr, string(output))
	}

	return json.RawMessage(inputStr), nil
}
