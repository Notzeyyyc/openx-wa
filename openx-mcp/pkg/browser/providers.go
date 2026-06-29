// Package browser provides web fetching and search capabilities for OpenX V2.
// It implements providers (Jina Reader, DuckDuckGo) with proper HTTP client
// management, connection pooling, response body cleanup, and size limiting
// to prevent memory leaks on resource-constrained devices.
package browser

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var (
	htmlTagRegex = regexp.MustCompile(`<[^>]*>`)
	scriptRegex  = regexp.MustCompile(`(?s)<script[^>]*>.*?</script>`)
	styleRegex   = regexp.MustCompile(`(?s)<style[^>]*>.*?</style>`)
	spaceRegex   = regexp.MustCompile(`\s+`)
)

// SearchProvider defines the interface for web search providers.
type SearchProvider interface {
	Search(ctx context.Context, query string) (string, error)
	Fetch(ctx context.Context, targetURL string) (string, error)
}

// JinaProvider uses Jina Reader API to fetch and convert web pages to markdown.
// No API key required. Rate limited to ~10 req/min on free tier.
type JinaProvider struct {
	client    *http.Client
	userAgent string
	maxSize   int64
}

// NewJinaProvider creates a new JinaProvider with a shared HTTP client.
func NewJinaProvider(timeout time.Duration, userAgent string, maxSize int64) *JinaProvider {
	client := &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			MaxIdleConns:        10,
			MaxIdleConnsPerHost: 5,
			IdleConnTimeout:     90 * time.Second,
			DisableKeepAlives:   false,
		},
	}

	return &JinaProvider{
		client:    client,
		userAgent: userAgent,
		maxSize:   maxSize,
	}
}

// Search performs a web search using Jina Search API.
func (jp *JinaProvider) Search(ctx context.Context, query string) (string, error) {
	searchURL := fmt.Sprintf("https://s.jina.ai/%s", url.PathEscape(query))

	req, err := http.NewRequestWithContext(ctx, "GET", searchURL, nil)
	if err != nil {
		return "", fmt.Errorf("create search request: %w", err)
	}

	req.Header.Set("User-Agent", jp.userAgent)
	req.Header.Set("Accept", "text/plain")

	resp, err := jp.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("search request failed: %w", err)
	}
	defer resp.Body.Close()

	// Always drain body for connection reuse
	body, err := io.ReadAll(io.LimitReader(resp.Body, jp.maxSize))
	if err != nil {
		return "", fmt.Errorf("read search response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("search returned status %d: %s", resp.StatusCode, string(body))
	}

	return string(body), nil
}

// Fetch retrieves a web page and returns it as clean markdown via Jina Reader.
func (jp *JinaProvider) Fetch(ctx context.Context, targetURL string) (string, error) {
	jinaURL := fmt.Sprintf("https://r.jina.ai/%s", targetURL)

	req, err := http.NewRequestWithContext(ctx, "GET", jinaURL, nil)
	if err != nil {
		return "", fmt.Errorf("create fetch request: %w", err)
	}

	req.Header.Set("User-Agent", jp.userAgent)
	req.Header.Set("Accept", "text/plain")

	resp, err := jp.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("fetch request failed: %w", err)
	}
	defer resp.Body.Close()

	// Limit body size to prevent memory exhaustion
	body, err := io.ReadAll(io.LimitReader(resp.Body, jp.maxSize))
	if err != nil {
		return "", fmt.Errorf("read fetch response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("fetch returned status %d: %s", resp.StatusCode, truncate(string(body), 200))
	}

	return string(body), nil
}

// CloseIdleConnections closes idle connections in the HTTP client transport.
func (jp *JinaProvider) CloseIdleConnections() {
	jp.client.CloseIdleConnections()
}

// DuckDuckGoProvider uses DuckDuckGo Instant Answer API for search.
// No API key required. Good for factual lookups.
type DuckDuckGoProvider struct {
	client    *http.Client
	userAgent string
	maxSize   int64
}

// NewDuckDuckGoProvider creates a new DuckDuckGoProvider with a shared HTTP client.
func NewDuckDuckGoProvider(timeout time.Duration, userAgent string, maxSize int64) *DuckDuckGoProvider {
	client := &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			MaxIdleConns:        5,
			MaxIdleConnsPerHost: 3,
			IdleConnTimeout:     90 * time.Second,
			DisableKeepAlives:   false,
		},
	}

	return &DuckDuckGoProvider{
		client:    client,
		userAgent: userAgent,
		maxSize:   maxSize,
	}
}

// DDGResponse represents the DuckDuckGo Instant Answer API response.
type DDGResponse struct {
	Abstract       string `json:"Abstract"`
	AbstractText   string `json:"AbstractText"`
	AbstractSource string `json:"AbstractSource"`
	AbstractURL    string `json:"AbstractURL"`
	Answer         string `json:"Answer"`
	AnswerType     string `json:"AnswerType"`
	Heading        string `json:"Heading"`
	RelatedTopics  []struct {
		Text     string `json:"Text"`
		FirstURL string `json:"FirstURL"`
	} `json:"RelatedTopics"`
}

// Search performs a search using DuckDuckGo Instant Answer API.
func (dd *DuckDuckGoProvider) Search(ctx context.Context, query string) (string, error) {
	searchURL := fmt.Sprintf("https://api.duckduckgo.com/?q=%s&format=json&no_html=1&skip_disambig=1",
		url.QueryEscape(query))

	req, err := http.NewRequestWithContext(ctx, "GET", searchURL, nil)
	if err != nil {
		return "", fmt.Errorf("create DDG request: %w", err)
	}

	req.Header.Set("User-Agent", dd.userAgent)

	resp, err := dd.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("DDG request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, dd.maxSize))
	if err != nil {
		return "", fmt.Errorf("read DDG response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("DDG returned status %d", resp.StatusCode)
	}

	var ddgResp DDGResponse
	if err := json.Unmarshal(body, &ddgResp); err != nil {
		return "", fmt.Errorf("parse DDG response: %w", err)
	}

	// Build result string
	var result strings.Builder

	if ddgResp.Heading != "" {
		result.WriteString(fmt.Sprintf("# %s\n\n", ddgResp.Heading))
	}

	if ddgResp.Answer != "" {
		result.WriteString(fmt.Sprintf("**Answer:** %s\n\n", ddgResp.Answer))
	}

	if ddgResp.AbstractText != "" {
		result.WriteString(ddgResp.AbstractText)
		result.WriteString("\n")
		if ddgResp.AbstractSource != "" {
			result.WriteString(fmt.Sprintf("\n*Source: %s* (%s)\n", ddgResp.AbstractSource, ddgResp.AbstractURL))
		}
	}

	if result.Len() == 0 {
		// Include related topics if no direct answer
		for i, topic := range ddgResp.RelatedTopics {
			if i >= 5 {
				break
			}
			if topic.Text != "" {
				result.WriteString(fmt.Sprintf("- %s\n", topic.Text))
			}
		}
	}

	if result.Len() == 0 {
		return "", fmt.Errorf("no results found for query: %s", query)
	}

	return result.String(), nil
}

// Fetch is not supported by DuckDuckGo provider (search only).
// It returns an error suggesting to use Jina provider for fetching.
func (dd *DuckDuckGoProvider) Fetch(ctx context.Context, targetURL string) (string, error) {
	return "", fmt.Errorf("DuckDuckGo provider does not support URL fetching, use Jina provider")
}

// CloseIdleConnections closes idle connections in the HTTP client transport.
func (dd *DuckDuckGoProvider) CloseIdleConnections() {
	dd.client.CloseIdleConnections()
}

// ExtractText strips HTML tags and returns plain text content.
func ExtractText(html string) string {
	html = scriptRegex.ReplaceAllString(html, "")
	html = styleRegex.ReplaceAllString(html, "")
	text := htmlTagRegex.ReplaceAllString(html, "")

	text = strings.ReplaceAll(text, "&amp;", "&")
	text = strings.ReplaceAll(text, "&lt;", "<")
	text = strings.ReplaceAll(text, "&gt;", ">")
	text = strings.ReplaceAll(text, "&quot;", "\"")
	text = strings.ReplaceAll(text, "&#39;", "'")
	text = strings.ReplaceAll(text, "&nbsp;", " ")

	text = spaceRegex.ReplaceAllString(text, " ")
	return strings.TrimSpace(text)
}

// truncate shortens a string to maxLen characters.
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
