package mcputil

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/notzeyyc/openx-v2/config"
	"github.com/notzeyyc/openx-v2/pkg/logging"
	"github.com/notzeyyc/openx-v2/pkg/toolchain"
)

const maxBodySize = 1 << 20 // 1MB

// HTTPServer wraps the ToolRegistry and exposes tools as REST endpoints.
type HTTPServer struct {
	registry *toolchain.ToolRegistry
	logger   *logging.Logger
	server   *http.Server
}

// NewHTTPServer creates a new HTTP API server for the MCP tools.
func NewHTTPServer(registry *toolchain.ToolRegistry, cfg *config.Config) *HTTPServer {
	hs := &HTTPServer{
		registry: registry,
		logger:   logging.GetLogger("http-api"),
	}

	mux := http.NewServeMux()

	// Tool endpoints
	mux.HandleFunc("/api/shell", hs.handleTool("shell_exec"))
	mux.HandleFunc("/api/battery", hs.handleTool("battery_status"))
	mux.HandleFunc("/api/network", hs.handleTool("network_stats"))
	mux.HandleFunc("/api/device", hs.handleTool("device_info"))
	mux.HandleFunc("/api/file/read", hs.handleTool("file_read"))
	mux.HandleFunc("/api/file/write", hs.handleTool("file_write"))
	mux.HandleFunc("/api/search", hs.handleTool("search_web"))
	mux.HandleFunc("/api/fetch", hs.handleTool("browser_fetch"))
	mux.HandleFunc("/api/extract", hs.handleTool("browser_extract_text"))
	mux.HandleFunc("/api/cron", hs.handleCron)
	mux.HandleFunc("/api/cron/", hs.handleCronDelete)
	mux.HandleFunc("/api/ai", hs.handleTool("ai_query"))
	mux.HandleFunc("/api/clipboard/read", hs.handleTool("clipboard_read"))
	mux.HandleFunc("/api/clipboard/write", hs.handleTool("clipboard_write"))
	mux.HandleFunc("/api/clipboard", hs.handleClipboard)
	mux.HandleFunc("/api/notification", hs.handleTool("notification_send"))
	mux.HandleFunc("/api/memory/set", hs.handleTool("memory_set"))
	mux.HandleFunc("/api/memory/get", hs.handleTool("memory_get"))
	mux.HandleFunc("/api/memory/list", hs.handleTool("memory_list"))
	mux.HandleFunc("/api/memory/delete", hs.handleTool("memory_delete"))
	mux.HandleFunc("/api/memory/clear", hs.handleTool("memory_clear"))

	// Health check
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "ok",
			"tools":  registry.List(),
		})
	})

	// Build handler chain: auth -> logging -> routes
	var handler http.Handler = mux
	handler = loggingMiddleware(handler, hs.logger)

	// Enable auth if tokens are configured
	if cfg != nil && cfg.Security.Enabled && len(cfg.Security.Tokens) > 0 {
		handler = authMiddleware(handler, cfg.Security.Tokens, hs.logger)
	}

	hs.server = &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Server.HTTPPort),
		Handler:      handler,
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 120 * time.Second,
	}

	return hs
}

// Start begins listening for HTTP requests. Non-blocking.
func (hs *HTTPServer) Start() error {
	hs.logger.Infof("HTTP API server starting on %s", hs.server.Addr)
	go func() {
		if err := hs.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			hs.logger.Errorf("HTTP server error: %v", err)
		}
	}()
	return nil
}

// Shutdown gracefully stops the HTTP server.
func (hs *HTTPServer) Shutdown(ctx context.Context) error {
	hs.logger.Info("shutting down HTTP API server")
	return hs.server.Shutdown(ctx)
}

// handleTool creates an HTTP handler that routes to a registered tool.
func (hs *HTTPServer) handleTool(toolName string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed, use POST"}`, http.StatusMethodNotAllowed)
			return
		}

		defer r.Body.Close()
		limitedBody := io.LimitReader(r.Body, maxBodySize)
		body, err := io.ReadAll(limitedBody)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"read body: %v"}`, err), http.StatusBadRequest)
			return
		}

		// Allow empty body (treat as empty JSON object)
		if len(body) == 0 {
			body = []byte("{}")
		}

		// Validate JSON
		if !json.Valid(body) {
			http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 55*time.Second)
		defer cancel()

		output, err := hs.registry.Execute(ctx, toolName, json.RawMessage(body))
		if err != nil {
			hs.logger.Warnf("tool %s failed: %v", toolName, err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error": err.Error(),
				"tool":  toolName,
			})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Write(output)
	}
}

// handleCron handles /api/cron (POST = add, GET = list).
func (hs *HTTPServer) handleCron(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		hs.handleTool("cron_list")(w, r)
	case http.MethodPost:
		hs.handleTool("cron_add")(w, r)
	default:
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// handleCronDelete handles /api/cron/{id} (DELETE = remove).
func (hs *HTTPServer) handleCronDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, `{"error":"method not allowed, use DELETE"}`, http.StatusMethodNotAllowed)
		return
	}

	// Extract ID from URL path: /api/cron/{id}
	path := strings.TrimPrefix(r.URL.Path, "/api/cron/")
	if path == "" {
		http.Error(w, `{"error":"missing cron job ID"}`, http.StatusBadRequest)
		return
	}

	input, _ := json.Marshal(map[string]string{"id": path})
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	output, err := hs.registry.Execute(ctx, "cron_remove", input)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(output)
}

// handleClipboard handles /api/clipboard (GET = read, POST = write).
func (hs *HTTPServer) handleClipboard(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		hs.handleTool("clipboard_read")(w, r)
	case http.MethodPost:
		hs.handleTool("clipboard_write")(w, r)
	default:
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// loggingMiddleware logs each HTTP request.
func loggingMiddleware(next http.Handler, logger *logging.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		logger.Debugf("%s %s %v", r.Method, r.URL.Path, time.Since(start))
	})
}

// authMiddleware checks for valid Bearer token in Authorization header.
func authMiddleware(next http.Handler, tokens []config.TokenConfig, logger *logging.Logger) http.Handler {
	// Build a set of valid tokens for fast lookup
	validTokens := make(map[string]bool)
	for _, t := range tokens {
		if t.Token != "" {
			validTokens[t.Token] = true
		}
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip auth for health check
		if r.URL.Path == "/api/health" {
			next.ServeHTTP(w, r)
			return
		}

		auth := r.Header.Get("Authorization")
		if auth == "" {
			logger.Warnf("missing auth: %s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)
			http.Error(w, `{"error":"unauthorized: missing Authorization header"}`, http.StatusUnauthorized)
			return
		}

		// Support "Bearer <token>" format
		token := strings.TrimPrefix(auth, "Bearer ")
		token = strings.TrimSpace(token)

		if !validTokens[token] {
			logger.Warnf("invalid token: %s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)
			http.Error(w, `{"error":"unauthorized: invalid token"}`, http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}
