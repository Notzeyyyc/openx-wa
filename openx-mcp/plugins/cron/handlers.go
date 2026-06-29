package cron

import (
	"context"
	"fmt"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/notzeyyc/openx-v2/pkg/mcputil"
)

type CronAddInput struct {
	ID       string `json:"id" jsonschema:"unique identifier for the scheduled task"`
	Schedule string `json:"schedule" jsonschema:"interval duration (e.g., '5m', '1h', '30s')"`
	Command  string `json:"command" jsonschema:"shell command to execute on each tick"`
}

type CronAddOutput struct {
	Message  string `json:"message" jsonschema:"status message for the cron add operation"`
	ID       string `json:"id" jsonschema:"the job ID that was created"`
	Schedule string `json:"schedule" jsonschema:"schedule that was requested"`
	Success  bool   `json:"success" jsonschema:"whether the job was added successfully"`
}

type CronListInput struct{}

type CronListOutput struct {
	Message string     `json:"message" jsonschema:"status message for the cron list operation"`
	Jobs    []JobInfo  `json:"jobs" jsonschema:"list of active jobs"`
	Count   int        `json:"count" jsonschema:"number of active jobs"`
}

type JobInfo struct {
	ID       string `json:"id"`
	Schedule string `json:"schedule"`
	Command  string `json:"command"`
}

type CronRemoveInput struct {
	ID string `json:"id" jsonschema:"identifier of the scheduled task to remove"`
}

type CronRemoveOutput struct {
	Message string `json:"message" jsonschema:"status message for the cron remove operation"`
	ID      string `json:"id" jsonschema:"identifier that was requested for removal"`
	Removed bool   `json:"removed" jsonschema:"whether the job was found and removed"`
}

func (p *CronPlugin) handleAdd(_ context.Context, _ *mcp.CallToolRequest, in CronAddInput) (*mcp.CallToolResult, CronAddOutput, error) {
	if in.ID == "" {
		msg := "job ID cannot be empty"
		return mcputil.TextResult(msg), CronAddOutput{Message: msg, Success: false}, nil
	}
	if in.Schedule == "" {
		msg := "schedule cannot be empty"
		return mcputil.TextResult(msg), CronAddOutput{Message: msg, Success: false}, nil
	}
	if in.Command == "" {
		msg := "command cannot be empty"
		return mcputil.TextResult(msg), CronAddOutput{Message: msg, Success: false}, nil
	}

	// Parse interval
	interval, err := time.ParseDuration(in.Schedule)
	if err != nil {
		msg := fmt.Sprintf("invalid schedule format %q: %v (use Go duration format: 5m, 1h, 30s)", in.Schedule, err)
		return mcputil.TextResult(msg), CronAddOutput{Message: msg, Success: false}, nil
	}

	// Minimum interval of 1 second
	if interval < time.Second {
		msg := "minimum interval is 1 second"
		return mcputil.TextResult(msg), CronAddOutput{Message: msg, Success: false}, nil
	}

	p.mu.Lock()

	// Check max jobs limit
	if len(p.jobs) >= MaxJobs {
		p.mu.Unlock()
		msg := fmt.Sprintf("maximum number of jobs (%d) reached", MaxJobs)
		return mcputil.TextResult(msg), CronAddOutput{Message: msg, Success: false}, nil
	}

	// Check if ID already exists
	if _, exists := p.jobs[in.ID]; exists {
		p.mu.Unlock()
		msg := fmt.Sprintf("job %q already exists, remove it first", in.ID)
		return mcputil.TextResult(msg), CronAddOutput{Message: msg, ID: in.ID, Success: false}, nil
	}

	// Create job with cancellation context
	jobCtx, cancel := context.WithCancel(context.Background())
	job := &CronJob{
		ID:       in.ID,
		Schedule: in.Schedule,
		Command:  in.Command,
		Interval: interval,
		cancel:   cancel,
		done:     make(chan struct{}),
	}

	p.jobs[in.ID] = job
	p.mu.Unlock()

	// Start the job goroutine
	go p.runJob(jobCtx, job)

	msg := fmt.Sprintf("job %q added (interval: %v, command: %s)", in.ID, interval, in.Command)
	return mcputil.TextResult(msg), CronAddOutput{
		Message:  msg,
		ID:       in.ID,
		Schedule: in.Schedule,
		Success:  true,
	}, nil
}

func (p *CronPlugin) handleList(_ context.Context, _ *mcp.CallToolRequest, _ CronListInput) (*mcp.CallToolResult, CronListOutput, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	jobs := make([]JobInfo, 0, len(p.jobs))
	for _, job := range p.jobs {
		jobs = append(jobs, JobInfo{
			ID:       job.ID,
			Schedule: job.Schedule,
			Command:  job.Command,
		})
	}

	msg := fmt.Sprintf("%d active jobs", len(jobs))
	return mcputil.TextResult(msg), CronListOutput{
		Message: msg,
		Jobs:    jobs,
		Count:   len(jobs),
	}, nil
}

func (p *CronPlugin) handleRemove(_ context.Context, _ *mcp.CallToolRequest, in CronRemoveInput) (*mcp.CallToolResult, CronRemoveOutput, error) {
	if in.ID == "" {
		msg := "job ID cannot be empty"
		return mcputil.TextResult(msg), CronRemoveOutput{Message: msg, Removed: false}, nil
	}

	p.mu.Lock()
	job, exists := p.jobs[in.ID]
	if !exists {
		p.mu.Unlock()
		msg := fmt.Sprintf("job %q not found", in.ID)
		return mcputil.TextResult(msg), CronRemoveOutput{Message: msg, ID: in.ID, Removed: false}, nil
	}
	delete(p.jobs, in.ID)
	p.mu.Unlock()

	// Cancel the running goroutine
	job.cancel()

	// Wait for goroutine to exit (with timeout)
	select {
	case <-job.done:
		p.logger.Infof("job %s stopped cleanly", in.ID)
	case <-time.After(5 * time.Second):
		p.logger.Warnf("job %s didn't stop within timeout", in.ID)
	}

	msg := fmt.Sprintf("job %q removed", in.ID)
	return mcputil.TextResult(msg), CronRemoveOutput{Message: msg, ID: in.ID, Removed: true}, nil
}
