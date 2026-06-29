// Package supervisor provides a process supervisor for OpenX V2.
// It handles panic recovery, exponential backoff restarts, crash dumps,
// graceful shutdown, and memory monitoring for long-running daemons.
package supervisor

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"sync"
	"syscall"
	"time"

	"github.com/notzeyyc/openx-v2/pkg/logging"
)

// Config holds supervisor configuration.
type Config struct {
	AutoRestart       bool
	BackoffMultiplier float64
	MaxBackoffSeconds int
	SavePanicDump     bool
	DumpDir           string
}

// ShutdownFunc is a function called during graceful shutdown.
type ShutdownFunc func(ctx context.Context) error

// Supervisor manages the lifecycle of the main server process.
type Supervisor struct {
	cfg           Config
	logger        *logging.Logger
	shutdownFuncs []ShutdownFunc
	mu            sync.Mutex
	done          chan struct{}
}

// New creates a new Supervisor with the given configuration.
func New(cfg Config) *Supervisor {
	return &Supervisor{
		cfg:    cfg,
		logger: logging.GetLogger("supervisor"),
		done:   make(chan struct{}),
	}
}

// OnShutdown registers a function to be called during graceful shutdown.
func (s *Supervisor) OnShutdown(fn ShutdownFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.shutdownFuncs = append(s.shutdownFuncs, fn)
}

// Run executes the given function with panic recovery and restart logic.
// It blocks until the context is cancelled or a termination signal is received.
func (s *Supervisor) Run(ctx context.Context, fn func(ctx context.Context) error) error {
	// Set up signal handling for graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Create a cancellable context
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	// Start memory monitor
	go s.monitorMemory(runCtx)

	// Main run loop with restart
	backoff := time.Second
	maxBackoff := time.Duration(s.cfg.MaxBackoffSeconds) * time.Second
	if maxBackoff == 0 {
		maxBackoff = 5 * time.Minute
	}

	errChan := make(chan error, 1)

	go func() {
		for {
			select {
			case <-runCtx.Done():
				errChan <- runCtx.Err()
				return
			default:
			}

			// Run with panic recovery
			err := s.runWithRecovery(runCtx, fn)

			if err == nil {
				// Clean exit
				errChan <- nil
				return
			}

			if runCtx.Err() != nil {
				// Context was cancelled, don't restart
				errChan <- runCtx.Err()
				return
			}

			if !s.cfg.AutoRestart {
				errChan <- err
				return
			}

			s.logger.Warnf("process exited with error: %v, restarting in %v", err, backoff)

			select {
			case <-runCtx.Done():
				errChan <- runCtx.Err()
				return
			case <-time.After(backoff):
			}

			// Exponential backoff
			backoff = time.Duration(float64(backoff) * s.cfg.BackoffMultiplier)
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		}
	}()

	// Wait for signal or completion
	select {
	case sig := <-sigChan:
		s.logger.Infof("received signal: %v, initiating graceful shutdown", sig)
		cancel()
		s.gracefulShutdown()
		return nil
	case err := <-errChan:
		return err
	}
}

// runWithRecovery executes fn and recovers from panics.
func (s *Supervisor) runWithRecovery(ctx context.Context, fn func(ctx context.Context) error) (retErr error) {
	defer func() {
		if r := recover(); r != nil {
			stack := debug.Stack()
			s.logger.Errorf("panic recovered: %v\n%s", r, string(stack))

			if s.cfg.SavePanicDump {
				s.savePanicDump(r, stack)
			}

			retErr = fmt.Errorf("panic: %v", r)
		}
	}()

	return fn(ctx)
}

// gracefulShutdown calls all registered shutdown functions.
func (s *Supervisor) gracefulShutdown() {
	s.mu.Lock()
	funcs := make([]ShutdownFunc, len(s.shutdownFuncs))
	copy(funcs, s.shutdownFuncs)
	s.mu.Unlock()

	// Give shutdown functions 30 seconds to complete
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	for i, fn := range funcs {
		if err := fn(ctx); err != nil {
			s.logger.Errorf("shutdown function %d failed: %v", i, err)
		}
	}

	s.logger.Info("graceful shutdown complete")
}

// savePanicDump writes panic information to a JSON file for debugging.
func (s *Supervisor) savePanicDump(r interface{}, stack []byte) {
	if s.cfg.DumpDir == "" {
		return
	}

	// Ensure dump directory exists
	if err := os.MkdirAll(s.cfg.DumpDir, 0755); err != nil {
		s.logger.Errorf("failed to create dump directory: %v", err)
		return
	}

	dump := map[string]interface{}{
		"panic":      fmt.Sprintf("%v", r),
		"stack":      string(stack),
		"goroutines": runtime.NumGoroutine(),
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
		"go_version": runtime.Version(),
		"os":         runtime.GOOS,
		"arch":       runtime.GOARCH,
	}

	// Add memory stats
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	dump["memory"] = map[string]interface{}{
		"alloc_mb":       m.Alloc / 1024 / 1024,
		"total_alloc_mb": m.TotalAlloc / 1024 / 1024,
		"heap_alloc_mb":  m.HeapAlloc / 1024 / 1024,
		"num_gc":         m.NumGC,
	}

	data, err := json.MarshalIndent(dump, "", "  ")
	if err != nil {
		s.logger.Errorf("failed to marshal panic dump: %v", err)
		return
	}

	filename := fmt.Sprintf("panic-%d.json", time.Now().Unix())
	path := filepath.Join(s.cfg.DumpDir, filename)

	if err := os.WriteFile(path, data, 0600); err != nil {
		s.logger.Errorf("failed to write panic dump: %v", err)
		return
	}

	s.logger.Infof("panic dump saved to: %s", path)
}

// monitorMemory periodically checks memory usage and forces GC if needed.
func (s *Supervisor) monitorMemory(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			var m runtime.MemStats
			runtime.ReadMemStats(&m)

			s.logger.Info("memory stats",
				logging.F("alloc_mb", m.Alloc/1024/1024),
				logging.F("heap_alloc_mb", m.HeapAlloc/1024/1024),
				logging.F("goroutines", runtime.NumGoroutine()),
				logging.F("num_gc", m.NumGC),
			)

			// Force GC if memory usage is high (>512MB for Termux)
			if m.Alloc > 512*1024*1024 {
				s.logger.Warn("high memory usage detected, forcing GC",
					logging.F("alloc_mb", m.Alloc/1024/1024),
				)
				runtime.GC()
			}
		}
	}
}
