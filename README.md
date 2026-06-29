## Setup (Security First)

This repo intentionally does **not** commit any secrets.

1. Copy environment template:
   - See [.env.example](.env.example:1)
2. Create a local `.env` file (ignored by git via [.gitignore](.gitignore:1))
3. Fill:
   - `OPENX_DEV_PHONE_NUMBER`
   - `OPENX_OPENROUTER_API_KEYS` (comma-separated)

### Secret scanning

Running tests will run a small secret scanner:

- Script: [scripts/scan-secrets.mjs](scripts/scan-secrets.mjs:1)
- Package script: `pnpm test` (mapped to `pnpm run scan:secrets` in [package.json](package.json:1))

## Plugins (Security Model)

Plugin config lives in:

- [package/plugins.json](package/plugins.json:1)
- Integrity pins: [package/plugins.lock.json](package/plugins.lock.json:1)

### Integrity (sha256 pinning)

Each plugin has an `id` and an `entry` (path or npm specifier). At runtime OpenX computes sha256 of the resolved entry file and requires a matching pin in `plugins.lock.json` unless `OPENX_ALLOW_UNPINNED_PLUGINS=true`.

### Permissions (capabilities)

Plugins get a `host` API and are blocked unless they requested a permission:

- `wa.send` for WhatsApp send
- `ai.chat` for OpenRouter calls

Enforcement happens inside the plugin host API in [package/openx/plugin_manager.mjs](package/openx/plugin_manager.mjs:1).

### Optional sandbox

Per plugin you can set `sandbox: true` in [package/plugins.json](package/plugins.json:1). This runs the plugin in a separate process (IPC), and privileged calls go through the permission-checked host API.
