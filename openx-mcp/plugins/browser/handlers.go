package browser

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/notzeyyc/openx-v2/pkg/browser"
	"github.com/notzeyyc/openx-v2/pkg/mcputil"
)

// Input/Output types

type SearchWebInput struct {
	Query    string `json:"query" jsonschema:"the search query string"`
	Provider string `json:"provider,omitempty" jsonschema:"search provider to use: jina (default) or duckduckgo"`
}

type SearchWebOutput struct {
	Message  string `json:"message" jsonschema:"status message"`
	Query    string `json:"query" jsonschema:"the search query that was executed"`
	Result   string `json:"result" jsonschema:"search results as markdown text"`
	Provider string `json:"provider" jsonschema:"the provider that returned results"`
	Cached   bool   `json:"cached" jsonschema:"whether the result was served from cache"`
	Success  bool   `json:"success" jsonschema:"whether the search succeeded"`
}

type BrowserFetchInput struct {
	URL string `json:"url" jsonschema:"the URL to fetch content from"`
}

type BrowserFetchOutput struct {
	Message string `json:"message" jsonschema:"status message"`
	URL     string `json:"url" jsonschema:"the URL that was fetched"`
	Content string `json:"content" jsonschema:"the page content as clean markdown"`
	Cached  bool   `json:"cached" jsonschema:"whether the result was served from cache"`
	Success bool   `json:"success" jsonschema:"whether the fetch succeeded"`
}

type ExtractTextInput struct {
	HTML string `json:"html" jsonschema:"HTML content to extract text from"`
}

type ExtractTextOutput struct {
	Message string `json:"message" jsonschema:"status message"`
	Text    string `json:"text" jsonschema:"extracted plain text"`
	Success bool   `json:"success" jsonschema:"whether extraction succeeded"`
}

// Handler implementations

func (p *BrowserPlugin) handleSearchWeb(ctx context.Context, _ *mcp.CallToolRequest, in SearchWebInput) (*mcp.CallToolResult, SearchWebOutput, error) {
	if in.Query == "" {
		msg := "query cannot be empty"
		return mcputil.TextResult(msg), SearchWebOutput{Message: msg, Success: false}, nil
	}

	// Check cache first
	cacheKey := "search:" + in.Query
	if p.cache != nil {
		if cached, found := p.cache.Get(cacheKey); found {
			msg := fmt.Sprintf("search results for %q (cached)", in.Query)
			return mcputil.TextResult(cached), SearchWebOutput{
				Message:  msg,
				Query:    in.Query,
				Result:   cached,
				Provider: "cache",
				Cached:   true,
				Success:  true,
			}, nil
		}
	}

	// Determine which provider to use
	var provider browser.SearchProvider
	var providerName string

	switch in.Provider {
	case "duckduckgo", "ddg":
		provider = p.ddg
		providerName = "duckduckgo"
	case "jina", "":
		provider = p.primary
		providerName = p.cfg.DefaultProvider
	default:
		provider = p.primary
		providerName = p.cfg.DefaultProvider
	}

	// Try primary provider
	result, err := provider.Search(ctx, in.Query)
	if err != nil {
		p.logger.Warnf("primary search failed (%s): %v, trying fallback", providerName, err)

		// Try fallback
		result, err = p.fallback.Search(ctx, in.Query)
		if err != nil {
			msg := fmt.Sprintf("search failed for %q: %v", in.Query, err)
			p.logger.Error(msg)
			return mcputil.TextResult(msg), SearchWebOutput{
				Message: msg,
				Query:   in.Query,
				Success: false,
			}, nil
		}
		providerName = "fallback"
	}

	// Cache the result
	if p.cache != nil && result != "" {
		p.cache.Set(cacheKey, result)
	}

	msg := fmt.Sprintf("search results for %q via %s", in.Query, providerName)
	return mcputil.TextResult(result), SearchWebOutput{
		Message:  msg,
		Query:    in.Query,
		Result:   result,
		Provider: providerName,
		Cached:   false,
		Success:  true,
	}, nil
}

func (p *BrowserPlugin) handleBrowserFetch(ctx context.Context, _ *mcp.CallToolRequest, in BrowserFetchInput) (*mcp.CallToolResult, BrowserFetchOutput, error) {
	if in.URL == "" {
		msg := "URL cannot be empty"
		return mcputil.TextResult(msg), BrowserFetchOutput{Message: msg, Success: false}, nil
	}

	// Check cache first
	cacheKey := "fetch:" + in.URL
	if p.cache != nil {
		if cached, found := p.cache.Get(cacheKey); found {
			msg := fmt.Sprintf("fetched %s (cached)", in.URL)
			return mcputil.TextResult(cached), BrowserFetchOutput{
				Message: msg,
				URL:     in.URL,
				Content: cached,
				Cached:  true,
				Success: true,
			}, nil
		}
	}

	// Fetch via Jina Reader (always use Jina for fetching)
	content, err := p.jina.Fetch(ctx, in.URL)
	if err != nil {
		msg := fmt.Sprintf("failed to fetch %s: %v", in.URL, err)
		p.logger.Error(msg)
		return mcputil.TextResult(msg), BrowserFetchOutput{
			Message: msg,
			URL:     in.URL,
			Success: false,
		}, nil
	}

	// Cache the result
	if p.cache != nil && content != "" {
		p.cache.Set(cacheKey, content)
	}

	msg := fmt.Sprintf("fetched %s successfully", in.URL)
	return mcputil.TextResult(content), BrowserFetchOutput{
		Message: msg,
		URL:     in.URL,
		Content: content,
		Cached:  false,
		Success: true,
	}, nil
}

func (p *BrowserPlugin) handleExtractText(_ context.Context, _ *mcp.CallToolRequest, in ExtractTextInput) (*mcp.CallToolResult, ExtractTextOutput, error) {
	if in.HTML == "" {
		msg := "HTML content cannot be empty"
		return mcputil.TextResult(msg), ExtractTextOutput{Message: msg, Success: false}, nil
	}

	text := browser.ExtractText(in.HTML)

	msg := fmt.Sprintf("extracted %d characters of text", len(text))
	return mcputil.TextResult(text), ExtractTextOutput{
		Message: msg,
		Text:    text,
		Success: true,
	}, nil
}
