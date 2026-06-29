package shell

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"runtime"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/notzeyyc/openx-v2/pkg/mcputil"
)

// Maximum output size to prevent memory exhaustion (1MB)
const maxOutputSize = 1024 * 1024

type ShellExecInput struct {
	Command        string `json:"command" jsonschema:"shell command to execute"`
	TimeoutSeconds int    `json:"timeout_seconds,omitempty" jsonschema:"optional timeout in seconds (default: 30)"`
}

type ShellExecOutput struct {
	Message  string `json:"message" jsonschema:"status message for the shell execution"`
	Stdout   string `json:"stdout" jsonschema:"captured standard output"`
	Stderr   string `json:"stderr" jsonschema:"captured standard error"`
	ExitCode int    `json:"exit_code" jsonschema:"process exit code when available"`
}

func (p *ShellPlugin) handleExec(ctx context.Context, _ *mcp.CallToolRequest, in ShellExecInput) (*mcp.CallToolResult, ShellExecOutput, error) {
	if in.Command == "" {
		msg := "command cannot be empty"
		return mcputil.TextResult(msg), ShellExecOutput{Message: msg, ExitCode: -1}, nil
	}

	// Mock mode: return simulated output
	if p.cfg.Dev.MockDevice {
		msg := fmt.Sprintf("[mock] executed: %s", in.Command)
		out := ShellExecOutput{
			Message:  msg,
			Stdout:   fmt.Sprintf("[mock output for: %s]", in.Command),
			Stderr:   "",
			ExitCode: 0,
		}
		return mcputil.TextResult(msg), out, nil
	}

	// Set timeout (default 30 seconds)
	timeout := 30 * time.Second
	if in.TimeoutSeconds > 0 {
		timeout = time.Duration(in.TimeoutSeconds) * time.Second
	}
	// Cap at 5 minutes to prevent indefinite hangs
	if timeout > 5*time.Minute {
		timeout = 5 * time.Minute
	}

	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// Determine shell based on OS
	shellCmd := "sh"
	shellArg := "-c"
	if runtime.GOOS == "windows" {
		shellCmd = "cmd"
		shellArg = "/c"
	}

	// Use CommandContext to ensure process is killed on timeout
	cmd := exec.CommandContext(execCtx, shellCmd, shellArg, in.Command)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()

	// Handle timeout
	if execCtx.Err() == context.DeadlineExceeded {
		msg := fmt.Sprintf("command timed out after %v: %s", timeout, in.Command)
		out := ShellExecOutput{
			Message:  msg,
			Stdout:   truncateOutput(stdout.String()),
			Stderr:   "timeout: process killed",
			ExitCode: -1,
		}
		return mcputil.TextResult(msg), out, nil
	}

	// Handle other errors
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = -1
		}
	}

	stdoutStr := truncateOutput(stdout.String())
	stderrStr := truncateOutput(stderr.String())

	var msg string
	if exitCode == 0 {
		msg = "command executed successfully"
	} else {
		msg = fmt.Sprintf("command exited with code %d", exitCode)
	}

	out := ShellExecOutput{
		Message:  msg,
		Stdout:   stdoutStr,
		Stderr:   stderrStr,
		ExitCode: exitCode,
	}

	return mcputil.TextResult(stdoutStr), out, nil
}

// truncateOutput limits output to maxOutputSize to prevent memory exhaustion.
func truncateOutput(s string) string {
	if len(s) > maxOutputSize {
		return s[:maxOutputSize] + "\n... [output truncated at 1MB]"
	}
	return s
}
