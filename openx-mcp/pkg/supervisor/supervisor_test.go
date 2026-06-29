package supervisor

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/notzeyyc/openx-v2/pkg/logging"
)

func init() {
	// Initialize logger for tests
	logging.Init(logging.LoggerConfig{
		Level:  "error",
		Format: "text",
		Output: "stderr",
	})
}

func TestSupervisorRunSuccess(t *testing.T) {
	s := New(Config{
		AutoRestart:       false,
		BackoffMultiplier: 1.5,
		MaxBackoffSeconds: 5,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	called := false
	err := s.runWithRecovery(ctx, func(ctx context.Context) error {
		called = true
		return nil
	})

	if err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
	if !called {
		t.Error("function should have been called")
	}
}

func TestSupervisorPanicRecovery(t *testing.T) {
	s := New(Config{
		AutoRestart:       false,
		BackoffMultiplier: 1.5,
		MaxBackoffSeconds: 5,
		SavePanicDump:     false,
	})

	ctx := context.Background()

	err := s.runWithRecovery(ctx, func(ctx context.Context) error {
		panic("test panic")
	})

	if err == nil {
		t.Error("expected error after panic recovery")
	}
	if err.Error() != "panic: test panic" {
		t.Errorf("error = %q, want 'panic: test panic'", err.Error())
	}
}

func TestSupervisorPanicDump(t *testing.T) {
	tmpDir := filepath.Join(os.TempDir(), "openx-test-dumps")
	defer os.RemoveAll(tmpDir)

	s := New(Config{
		AutoRestart:       false,
		BackoffMultiplier: 1.5,
		MaxBackoffSeconds: 5,
		SavePanicDump:     true,
		DumpDir:           tmpDir,
	})

	ctx := context.Background()

	_ = s.runWithRecovery(ctx, func(ctx context.Context) error {
		panic("dump test panic")
	})

	// Check that dump file was created
	entries, err := os.ReadDir(tmpDir)
	if err != nil {
		t.Fatalf("failed to read dump dir: %v", err)
	}
	if len(entries) == 0 {
		t.Error("expected at least one panic dump file")
	}
}

func TestSupervisorOnShutdown(t *testing.T) {
	s := New(Config{})

	shutdownCalled := false
	s.OnShutdown(func(ctx context.Context) error {
		shutdownCalled = true
		return nil
	})

	s.gracefulShutdown()

	if !shutdownCalled {
		t.Error("shutdown function should have been called")
	}
}

func TestSupervisorShutdownError(t *testing.T) {
	s := New(Config{})

	s.OnShutdown(func(ctx context.Context) error {
		return fmt.Errorf("shutdown error")
	})

	// Should not panic even if shutdown function returns error
	s.gracefulShutdown()
}
