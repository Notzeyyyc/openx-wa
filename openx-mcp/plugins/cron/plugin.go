package cron

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/notzeyyc/openx-v2/pkg/logging"
	"github.com/notzeyyc/openx-v2/pkg/toolchain"
)

// MaxJobs is the maximum number of concurrent cron jobs to prevent goroutine explosion.
const MaxJobs = 100

// CronJob represents a scheduled job with proper cancellation support.
type CronJob struct {
	ID       string
	Schedule string
	Command  string
	Interval time.Duration
	cancel   context.CancelFunc
	done     chan struct{}
}

// CronPlugin provides cron-style scheduling with proper goroutine lifecycle management.
// Each job runs in its own goroutine with context cancellation support.
type CronPlugin struct {
	mu       sync.RWMutex
	jobs     map[string]*CronJob
	registry *toolchain.ToolRegistry
	logger   *logging.Logger
}

func New(registry *toolchain.ToolRegistry) *CronPlugin {
	return &CronPlugin{
		jobs:     make(map[string]*CronJob),
		registry: registry,
		logger:   logging.GetLogger("cron"),
	}
}

func (p *CronPlugin) Name() string {
	return "cron"
}

func (p *CronPlugin) Register(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "cron_add",
		Description: "Add a scheduled task that runs at a specified interval. Maximum 100 concurrent jobs.",
	}, p.handleAdd)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "cron_list",
		Description: "List all active scheduled tasks.",
	}, p.handleList)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "cron_remove",
		Description: "Remove a scheduled task by ID. The running goroutine is properly cancelled.",
	}, p.handleRemove)
}

// Shutdown cancels all running jobs and waits for them to exit.
// This prevents goroutine leaks on daemon restart.
func (p *CronPlugin) Shutdown(ctx context.Context) error {
	p.logger.Info("shutting down cron plugin, cancelling all jobs")

	p.mu.Lock()
	jobs := make([]*CronJob, 0, len(p.jobs))
	for _, job := range p.jobs {
		jobs = append(jobs, job)
	}
	p.jobs = make(map[string]*CronJob)
	p.mu.Unlock()

	// Cancel all jobs
	for _, job := range jobs {
		job.cancel()
	}

	// Wait for all to finish with timeout
	timeout := time.NewTimer(10 * time.Second)
	defer timeout.Stop()

	for _, job := range jobs {
		select {
		case <-job.done:
			p.logger.Debugf("job %s stopped", job.ID)
		case <-timeout.C:
			p.logger.Warnf("timeout waiting for job %s to stop", job.ID)
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	p.logger.Info("all cron jobs stopped")
	return nil
}

// runJob executes a job at the specified interval until cancelled.
func (p *CronPlugin) runJob(ctx context.Context, job *CronJob) {
	defer close(job.done)

	ticker := time.NewTicker(job.Interval)
	defer ticker.Stop()

	p.logger.Infof("job %s started (interval: %v, command: %s)", job.ID, job.Interval, job.Command)

	for {
		select {
		case <-ctx.Done():
			p.logger.Infof("job %s cancelled", job.ID)
			return
		case <-ticker.C:
			// Execute the command via the registry if available
			if p.registry != nil {
				input, _ := json.Marshal(map[string]string{"command": job.Command})
				_, err := p.registry.Execute(ctx, "shell_exec", input)
				if err != nil {
					p.logger.Warnf("job %s execution failed: %v", job.ID, err)
				}
			}
		}
	}
}
