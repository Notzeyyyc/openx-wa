package core

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/notzeyyc/openx-v2/config"
	"github.com/notzeyyc/openx-v2/pkg/devicecontext"
	"github.com/notzeyyc/openx-v2/pkg/logging"
	"github.com/notzeyyc/openx-v2/pkg/toolchain"
	"github.com/notzeyyc/openx-v2/plugins/ai"
	browserplugin "github.com/notzeyyc/openx-v2/plugins/browser"
	"github.com/notzeyyc/openx-v2/plugins/chainrun"
	"github.com/notzeyyc/openx-v2/plugins/clipboard"
	"github.com/notzeyyc/openx-v2/plugins/cron"
	"github.com/notzeyyc/openx-v2/plugins/device"
	fileplugin "github.com/notzeyyc/openx-v2/plugins/file"
	memoryplugin "github.com/notzeyyc/openx-v2/plugins/memory"
	"github.com/notzeyyc/openx-v2/plugins/notification"
	"github.com/notzeyyc/openx-v2/plugins/shell"
	"github.com/notzeyyc/openx-v2/plugins/whatsapp"
)

// PluginManager holds all loaded plugins and provides lifecycle management.
type PluginManager struct {
	plugins []Plugin
	logger  *logging.Logger
}

// NewPluginManager creates a new plugin manager.
func NewPluginManager() *PluginManager {
	return &PluginManager{
		plugins: make([]Plugin, 0, 12),
		logger:  logging.GetLogger("loader"),
	}
}

// LoadPlugins initializes and registers all enabled plugins.
func (pm *PluginManager) LoadPlugins(server *mcp.Server, cfg *config.Config, dctx *devicecontext.DeviceContext, registry *toolchain.ToolRegistry) error {
	if server == nil {
		return fmt.Errorf("server cannot be nil")
	}
	if cfg == nil {
		return fmt.Errorf("config cannot be nil")
	}
	if registry == nil {
		return fmt.Errorf("registry cannot be nil")
	}

	if cfg.Plugins.Shell {
		pm.plugins = append(pm.plugins, shell.New(cfg, registry))
	}
	if cfg.Plugins.Device {
		pm.plugins = append(pm.plugins, device.New(cfg, dctx, registry))
	}
	if cfg.Plugins.File {
		pm.plugins = append(pm.plugins, fileplugin.New(dctx, registry))
	}
	if cfg.Plugins.WhatsApp {
		pm.plugins = append(pm.plugins, whatsapp.New(cfg.Bridge.BaileysURL, registry))
	}
	if cfg.Plugins.Clipboard {
		pm.plugins = append(pm.plugins, clipboard.New(cfg, dctx, registry))
	}
	if cfg.Plugins.Notification {
		pm.plugins = append(pm.plugins, notification.New(cfg, dctx, registry))
	}
	if cfg.Plugins.AI {
		pm.plugins = append(pm.plugins, ai.New(cfg.AI, registry))
	}
	if cfg.Plugins.Cron {
		pm.plugins = append(pm.plugins, cron.New(registry))
	}
	if cfg.Plugins.Memory {
		memPlugin, err := memoryplugin.New(cfg, registry)
		if err != nil {
			pm.logger.Errorf("failed to initialize memory plugin: %v", err)
		} else {
			pm.plugins = append(pm.plugins, memPlugin)
		}
	}
	if cfg.Plugins.Browser {
		pm.plugins = append(pm.plugins, browserplugin.New(cfg, registry))
	}

	// ChainRun is always loaded (enables tool chaining capability)
	pm.plugins = append(pm.plugins, chainrun.New(registry))

	for _, plugin := range pm.plugins {
		plugin.Register(server)
		pm.logger.Infof("registered plugin: %s", plugin.Name())

		// Register with toolchain if the plugin supports it
		if cp, ok := plugin.(ChainablePlugin); ok {
			if err := cp.RegisterToolchain(registry); err != nil {
				pm.logger.Warnf("plugin %s failed to register with toolchain: %v", plugin.Name(), err)
			}
		}
	}

	return nil
}

// Shutdown gracefully shuts down all plugins that implement ShutdownablePlugin.
func (pm *PluginManager) Shutdown(ctx context.Context) error {
	pm.logger.Info("shutting down all plugins")

	var lastErr error
	for _, plugin := range pm.plugins {
		if sp, ok := plugin.(ShutdownablePlugin); ok {
			pm.logger.Infof("shutting down plugin: %s", plugin.Name())
			if err := sp.Shutdown(ctx); err != nil {
				pm.logger.Errorf("plugin %s shutdown failed: %v", plugin.Name(), err)
				lastErr = err
			}
		}
	}

	return lastErr
}

// Plugins returns the list of loaded plugins.
func (pm *PluginManager) Plugins() []Plugin {
	return pm.plugins
}

// LoadPlugins is the legacy function for backward compatibility.
// It creates a PluginManager internally and loads plugins.
func LoadPlugins(server *mcp.Server, cfg *config.Config, dctx *devicecontext.DeviceContext, registry *toolchain.ToolRegistry) error {
	pm := NewPluginManager()
	return pm.LoadPlugins(server, cfg, dctx, registry)
}
