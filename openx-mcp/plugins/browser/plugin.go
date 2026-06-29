package browser

import (
	"context"
	"encoding/json"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/notzeyyc/openx-v2/config"
	"github.com/notzeyyc/openx-v2/pkg/browser"
	"github.com/notzeyyc/openx-v2/pkg/logging"
	"github.com/notzeyyc/openx-v2/pkg/toolchain"
)

// BrowserPlugin provides web search and content fetching capabilities.
type BrowserPlugin struct {
	primary  browser.SearchProvider
	fallback browser.SearchProvider
	cache    *browser.ResponseCache
	registry *toolchain.ToolRegistry
	cfg      *config.BrowserConfig
	logger   *logging.Logger
	jina     *browser.JinaProvider
	ddg      *browser.DuckDuckGoProvider
}

// New creates a new BrowserPlugin instance.
func New(cfg *config.Config, registry *toolchain.ToolRegistry) *BrowserPlugin {
	timeout := time.Duration(cfg.Browser.JinaTimeoutSeconds) * time.Second
	maxSize := cfg.Browser.MaxContentSizeBytes

	jina := browser.NewJinaProvider(timeout, cfg.Browser.UserAgent, maxSize)
	ddg := browser.NewDuckDuckGoProvider(timeout, cfg.Browser.UserAgent, maxSize)

	var cache *browser.ResponseCache
	if cfg.Browser.CacheResponses {
		ttl := time.Duration(cfg.Browser.CacheTTLSeconds) * time.Second
		cache = browser.NewResponseCache(cfg.Browser.MaxCacheEntries, ttl)
	}

	var primary, fallback browser.SearchProvider
	if cfg.Browser.DefaultProvider == "duckduckgo" {
		primary = ddg
		fallback = jina
	} else {
		primary = jina
		fallback = ddg
	}

	return &BrowserPlugin{
		primary:  primary,
		fallback: fallback,
		cache:    cache,
		registry: registry,
		cfg:      &cfg.Browser,
		logger:   logging.GetLogger("browser"),
		jina:     jina,
		ddg:      ddg,
	}
}

// Name returns the plugin name.
func (p *BrowserPlugin) Name() string {
	return "browser"
}

// Register registers MCP tools with the server.
func (p *BrowserPlugin) Register(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "search_web",
		Description: "Search the web using Jina or DuckDuckGo. Returns relevant results as markdown text. No API key required.",
	}, p.handleSearchWeb)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "browser_fetch",
		Description: "Fetch a web page and return its content as clean markdown. Uses Jina Reader to convert HTML to readable text.",
	}, p.handleBrowserFetch)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "browser_extract_text",
		Description: "Extract plain text from HTML content by stripping all tags, scripts, and styles.",
	}, p.handleExtractText)
}

// RegisterToolchain registers browser tools with the internal tool registry for chaining.
func (p *BrowserPlugin) RegisterToolchain(registry *toolchain.ToolRegistry) error {
	handlers := map[string]struct {
		fn   func(ctx context.Context, input json.RawMessage) (json.RawMessage, error)
		desc string
	}{
		"search_web": {
			fn:   p.chainHandleSearch,
			desc: "Search the web using Jina or DuckDuckGo",
		},
		"browser_fetch": {
			fn:   p.chainHandleFetch,
			desc: "Fetch a web page as clean markdown",
		},
		"browser_extract_text": {
			fn:   p.chainHandleExtract,
			desc: "Extract plain text from HTML",
		},
	}

	for name, h := range handlers {
		if err := registry.Register(name, h.fn, h.desc); err != nil {
			return err
		}
	}

	return nil
}

// Shutdown performs cleanup on plugin shutdown.
func (p *BrowserPlugin) Shutdown(ctx context.Context) error {
	p.logger.Info("shutting down browser plugin")

	// Close idle HTTP connections to prevent resource leaks
	if p.jina != nil {
		p.jina.CloseIdleConnections()
	}
	if p.ddg != nil {
		p.ddg.CloseIdleConnections()
	}

	// Clear cache
	if p.cache != nil {
		p.cache.Clear()
	}

	return nil
}

// Chain handler wrappers
func (p *BrowserPlugin) chainHandleSearch(ctx context.Context, input json.RawMessage) (json.RawMessage, error) {
	var in SearchWebInput
	if err := json.Unmarshal(input, &in); err != nil {
		return nil, err
	}
	_, out, err := p.handleSearchWeb(ctx, nil, in)
	if err != nil {
		return nil, err
	}
	return json.Marshal(out)
}

func (p *BrowserPlugin) chainHandleFetch(ctx context.Context, input json.RawMessage) (json.RawMessage, error) {
	var in BrowserFetchInput
	if err := json.Unmarshal(input, &in); err != nil {
		return nil, err
	}
	_, out, err := p.handleBrowserFetch(ctx, nil, in)
	if err != nil {
		return nil, err
	}
	return json.Marshal(out)
}

func (p *BrowserPlugin) chainHandleExtract(ctx context.Context, input json.RawMessage) (json.RawMessage, error) {
	var in ExtractTextInput
	if err := json.Unmarshal(input, &in); err != nil {
		return nil, err
	}
	_, out, err := p.handleExtractText(ctx, nil, in)
	if err != nil {
		return nil, err
	}
	return json.Marshal(out)
}
