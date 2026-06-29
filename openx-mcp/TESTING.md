# Testing OpenX V2

This guide explains how to test the OpenX V2 MCP server on a PC (Mock Mode) and on Android/Termux (Real Mode).

## PC Testing (Mock Mode)

Use this mode to develop and verify tool registration without needing a physical Android device.

1.  **Configure Mock Mode**: Set `dev.mock_device: true` in [config.yaml](config.yaml).
2.  **Install Dependencies**:
    ```bash
    go mod tidy
    ```
3.  **Run Server**:
    ```bash
    go run main.go
    ```
4.  **Connect to Cline**: Add the following to your Cline `settings.json`:
    ```json
    {
      "mcpServers": {
        "openx-v2": {
          "command": "go",
          "args": ["run", "d:/codingan/openx-v2/main.go"],
          "cwd": "d:/codingan/openx-v2"
        }
      }
    }
    ```
5.  **Verify**: Open Cline and verify that `openx-v2` appears in the MCP tool list.
6.  **Test Tools**: Try these prompts in Cline chat:
    *   "jalanin command: echo hello world"
    *   "cek status battery"
    *   "baca file /tmp/test.txt" (Note: path might vary on Windows)
    *   "tulis file /tmp/test.txt dengan isi: hello openx"

## Android/Termux Testing (Real Mode)

Use this mode for production deployment on your Android device.

1.  **Configure Real Mode**: Set `dev.mock_device: false` in [config.yaml](config.yaml).
2.  **Install Go in Termux**:
    ```bash
    pkg install golang git
    ```
3.  **Clone and Prepare**:
    ```bash
    git clone <your-repo-url>
    cd openx-v2
    go mod tidy
    ```
4.  **Build**:
    ```bash
    go build -o openx-v2 .
    ```
5.  **Run**:
    ```bash
    ./openx-v2
    ```
6.  **Connect Cline**: Use the same `settings.json` pattern, but pointing to the Termux path or binary.

## Manual Tool Test via code (Optional)

If you want to test specific handlers without the full MCP transport:

*   **Shell**: Create a small `test/test_shell.go` that imports `plugins/shell` and calls `handleExec`.
*   **Device**: Create `test/test_device.go` that calls `handleBatteryStatus`.
