# OpenX V2 Agent Guidelines

This document provides context for AI agents working on the OpenX V2 repository. It highlights key architectural decisions, testing workflows, and conventions to avoid common mistakes.

## Architecture & Entrypoints

- **Entrypoint:** `main.go`. This initializes configuration, sets up the `devicecontext`, and starts the MCP (Model Context Protocol) server via `go-sdk/mcp`.
- **Plugin System:** Functionality is implemented as plugins in the `plugins/` directory.
  - The `core.Plugin` interface (in `core/plugin.go`) requires `Name() string` and `Register(server *mcp.Server)`.
  - Plugins are loaded and registered dynamically in `core/loader.go` based on the configuration in `config.yaml`.
- **Configuration:** Managed via `config.yaml`. 
  - Crucially, it includes `dev.mock_device`, which determines if the app runs in PC Mock Mode or Android/Termux Real Mode.
  - Features (shell, device, file, whatsapp, etc.) are toggled in the `plugins` section.

## Testing & Execution

The project supports two main execution environments:

### PC Mock Mode (Development)
- **Purpose:** Developing and verifying tool registration without a physical Android device.
- **Setup:** Ensure `dev.mock_device: true` is set in `config.yaml`.
- **Run Command:** `go run main.go`
- **Dependency Management:** `go mod tidy`
- **Testing via Cline/MCP:** Configured in `settings.json` using the local path to the `go run` command.

### Android/Termux Mode (Production)
- **Purpose:** Real execution on an Android device via Termux.
- **Setup:** Ensure `dev.mock_device: false` is set in `config.yaml`.
- **Dependencies (Termux):** Requires `pkg install golang git` on the device.
- **Build Command:** `go build -o openx-v2 .`
- **Run Command:** `./openx-v2`

## Conventions & Gotchas

- **MCP Integration:** This is a Go MCP server using `github.com/modelcontextprotocol/go-sdk`. When adding new functionality, it should likely be implemented as an MCP tool within a specific plugin.
- **Mock vs. Real Implementations:** Pay attention to `dev.mock_device`. Plugins (especially the `device` plugin) must gracefully handle execution on a PC vs. an Android device, relying on the `devicecontext` package to abstract environment-specific behavior.
- **Adding a New Plugin:**
  1. Create a new package under `plugins/`.
  2. Implement the `core.Plugin` interface.
  3. Register MCP tools in the `Register(server *mcp.Server)` method.
  4. Add a toggle for the plugin in `config.yaml` (and `config/config.go` if applicable).
  5. Add the initialization logic to `core.LoadPlugins` in `core/loader.go`.
