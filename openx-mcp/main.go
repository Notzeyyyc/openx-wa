package main

import (
	"context"
	"log"
	"net/http"
	_ "net/http/pprof"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/notzeyyc/openx-v2/config"
	"github.com/notzeyyc/openx-v2/core"
	"github.com/notzeyyc/openx-v2/pkg/auth"
	"github.com/notzeyyc/openx-v2/pkg/devicecontext"
	"github.com/notzeyyc/openx-v2/pkg/logging"
	"github.com/notzeyyc/openx-v2/pkg/mcputil"
	"github.com/notzeyyc/openx-v2/pkg/supervisor"
	"github.com/notzeyyc/openx-v2/pkg/toolchain"
)

func main() {
	// Load configuration
	cfg, err := config.Load("config.yaml")
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	// Initialize structured logging
	if err := logging.Init(logging.LoggerConfig{
		Level:   cfg.Logging.Level,
		Format:  cfg.Logging.Format,
		Output:  cfg.Logging.Output,
		File:    cfg.Logging.File,
		Module:  "main",
		MaxSize: int64(cfg.Logging.MaxSizeMB) * 1024 * 1024,
	}); err != nil {
		log.Printf("warning: failed to initialize structured logging: %v", err)
	}

	logger := logging.GetLogger("main")
	logger.Info("OpenX V2 starting",
		logging.F("version", "v2.0.0"),
		logging.F("mock_mode", cfg.Dev.MockDevice),
	)

	// Initialize device context with multi-mode support
	dctx, err := devicecontext.NewDeviceContext(cfg)
	if err != nil {
		logger.Warnf("device context initialization failed: %v", err)
		// Fallback to legacy (mock) context
		dctx, _ = devicecontext.NewDeviceContextLegacy()
	}
	logger.Infof("device mode: %s", dctx.Mode)

	// Initialize auth middleware
	// TODO: Wire auth middleware to MCP tool handlers when security is enabled.
	// Currently initialized for lifecycle management only — CheckAccess() is not
	// called by any plugin. To activate, add authMiddleware.CheckAccess(token, tool)
	// calls in each plugin's handler or as MCP server middleware.
	authMiddleware := auth.NewMiddleware(&cfg.Security)

	// Start pprof server for debugging (only in dev mode)
	if cfg.Dev.MockDevice {
		go func() {
			logger.Info("pprof available at http://localhost:6060/debug/pprof/")
			http.ListenAndServe("localhost:6060", nil)
		}()
	}

	// Create supervisor
	sup := supervisor.New(supervisor.Config{
		AutoRestart:       cfg.Error.AutoRestart,
		BackoffMultiplier: cfg.Error.BackoffMultiplier,
		MaxBackoffSeconds: cfg.Error.MaxBackoffSeconds,
		SavePanicDump:     cfg.Error.SavePanicDump,
		DumpDir:           cfg.Error.DumpDir,
	})

	// Create MCP server
	server := mcp.NewServer(&mcp.Implementation{
		Name:    "openx-v2",
		Version: "v2.0.0",
	}, nil)

	// Create the tool registry for internal tool chaining
	registry := toolchain.NewToolRegistry()

	// Load plugins using the plugin manager
	pluginManager := core.NewPluginManager()
	if err := pluginManager.LoadPlugins(server, cfg, dctx, registry); err != nil {
		logger.Fatalf("load plugins: %v", err)
	}

	// Start HTTP API server if configured
	var httpAPI *mcputil.HTTPServer
	if cfg.Server.HTTPPort > 0 {
		httpAPI = mcputil.NewHTTPServer(registry, cfg)
		if err := httpAPI.Start(); err != nil {
			logger.Warnf("HTTP API server failed to start: %v", err)
		}
	}

	// Register shutdown handlers
	sup.OnShutdown(func(ctx context.Context) error {
		logger.Info("shutting down plugins")
		return pluginManager.Shutdown(ctx)
	})
	if httpAPI != nil {
		sup.OnShutdown(func(ctx context.Context) error {
			return httpAPI.Shutdown(ctx)
		})
	}
	sup.OnShutdown(func(ctx context.Context) error {
		logger.Info("closing device context")
		return dctx.Close()
	})
	sup.OnShutdown(func(ctx context.Context) error {
		logger.Info("closing auth middleware")
		authMiddleware.Close()
		return nil
	})

	// Run server with supervisor (panic recovery + graceful shutdown)
	logger.Info("OpenX V2 server starting")
	if err := sup.Run(context.Background(), func(ctx context.Context) error {
		return server.Run(ctx, &mcp.StdioTransport{})
	}); err != nil {
		logger.Fatalf("server error: %v", err)
	}

	logger.Info("OpenX V2 server stopped")
}
