package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/notzeyyc/openx-v2/pkg/mcputil"
)

const requestTimeout = 55 * time.Second

const maxAIResponseSize = 1 << 20 // 1MB

type AIQueryInput struct {
	Prompt       string `json:"prompt" jsonschema:"prompt to send to the AI model"`
	SystemPrompt string `json:"system_prompt,omitempty" jsonschema:"optional system prompt"`
	Model        string `json:"model,omitempty" jsonschema:"optional model override (e.g. deepseek/deepseek-v4-pro)"`
}

type AIQueryOutput struct {
	Message  string `json:"message" jsonschema:"status message for the AI query"`
	Provider string `json:"provider" jsonschema:"configured AI provider"`
	Model    string `json:"model" jsonschema:"configured model name"`
	Response string `json:"response" jsonschema:"AI response text when available"`
}

func (p *AIPlugin) handleQuery(_ context.Context, _ *mcp.CallToolRequest, in AIQueryInput) (*mcp.CallToolResult, AIQueryOutput, error) {
	prompt := in.Prompt
	if in.SystemPrompt != "" {
		prompt = "[System Instructions]\n" + in.SystemPrompt + "\n\n[User Message]\n" + in.Prompt
	}

	// Model selection: per-request override > config default
	model := in.Model
	if model == "" {
		model = p.cfg.Model
	}

	var response string
	var err error

	switch p.cfg.Provider {
	case "custom":
		response, err = p.callCustom(prompt, model)
	case "openrouter":
		response, err = p.callOpenRouter(prompt)
	default:
		err = fmt.Errorf("unknown provider: %s", p.cfg.Provider)
	}

	if err != nil {
		msg := fmt.Sprintf("AI query failed: %v", err)
		return mcputil.TextResult(msg), AIQueryOutput{
			Message:  msg,
			Provider: p.cfg.Provider,
			Model:    model,
		}, nil
	}

	out := AIQueryOutput{
		Message:  "success",
		Provider: p.cfg.Provider,
		Model:    model,
		Response: response,
	}
	return mcputil.TextResult(response), out, nil
}

// callCustom sends a request to a custom REST API endpoint.
func (p *AIPlugin) callCustom(prompt string, model string) (string, error) {
	baseURL := p.cfg.BaseURL
	if baseURL == "" {
		return "", fmt.Errorf("base_url not configured")
	}

	method := strings.ToUpper(p.cfg.Method)
	if method == "" {
		method = "GET"
	}

	paramName := p.cfg.ParamName
	if paramName == "" {
		paramName = "text"
	}

	apiKeyParam := p.cfg.APIKeyParam
	if apiKeyParam == "" {
		apiKeyParam = "apikey"
	}

	answerField := p.cfg.AnswerField
	if answerField == "" {
		answerField = "response"
	}

	// Use provided model or config default
	if model == "" {
		model = p.cfg.Model
	}

	ctx, cancel := context.WithTimeout(context.Background(), requestTimeout)
	defer cancel()

	var resp *http.Response
	var reqErr error

	if method == "GET" {
		u, parseErr := url.Parse(baseURL)
		if parseErr != nil {
			return "", fmt.Errorf("invalid base_url: %w", parseErr)
		}
		q := u.Query()
		q.Set(paramName, prompt)
		if model != "" {
			q.Set("model", model)
		}
		u.RawQuery = q.Encode()

		req, _ := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
		for k, v := range p.cfg.Headers {
			req.Header.Set(k, v)
		}
		if p.cfg.APIKey != "" {
			req.Header.Set("Authorization", "Bearer "+p.cfg.APIKey)
		}
		resp, reqErr = http.DefaultClient.Do(req)
	} else {
		body := map[string]string{
			paramName: prompt,
		}
		if model != "" {
			body["model"] = model
		}
		jsonBody, _ := json.Marshal(body)

		req, _ := http.NewRequestWithContext(ctx, "POST", baseURL, strings.NewReader(string(jsonBody)))
		req.Header.Set("Content-Type", "application/json")
		for k, v := range p.cfg.Headers {
			req.Header.Set(k, v)
		}
		if p.cfg.APIKey != "" {
			req.Header.Set("Authorization", "Bearer "+p.cfg.APIKey)
		}
		resp, reqErr = http.DefaultClient.Do(req)
	}

	if reqErr != nil {
		return "", fmt.Errorf("request failed: %w", reqErr)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, maxAIResponseSize))
		return "", fmt.Errorf("API error (%d): %s", resp.StatusCode, string(bodyBytes))
	}

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxAIResponseSize))
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	return extractAnswer(respBody, answerField)
}

// callOpenRouter sends a request to OpenRouter API (OpenAI-compatible).
func (p *AIPlugin) callOpenRouter(prompt string) (string, error) {
	apiKey := p.cfg.APIKey
	if apiKey == "" && len(p.cfg.APIKeys) > 0 {
		apiKey = p.cfg.APIKeys[0]
	}
	if apiKey == "" {
		return "", fmt.Errorf("no API key configured")
	}

	model := p.cfg.Model
	if model == "" {
		model = "google/gemini-2.5-flash"
	}

	messages := []map[string]string{
		{"role": "user", "content": prompt},
	}

	body := map[string]interface{}{
		"model":       model,
		"messages":    messages,
		"temperature": 0.7,
	}
	jsonBody, _ := json.Marshal(body)

	ctx, cancel := context.WithTimeout(context.Background(), requestTimeout)
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, "POST", "https://openrouter.ai/api/v1/chat/completions", strings.NewReader(string(jsonBody)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("HTTP-Referer", "https://github.com/openxx")
	req.Header.Set("X-Title", "OpenX-V2 MCP")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, maxAIResponseSize))
		return "", fmt.Errorf("API error (%d): %s", resp.StatusCode, string(bodyBytes))
	}

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxAIResponseSize))
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("parse response: %w", err)
	}
	if len(result.Choices) == 0 || result.Choices[0].Message.Content == "" {
		return "", fmt.Errorf("empty response from OpenRouter")
	}

	return result.Choices[0].Message.Content, nil
}

// extractAnswer extracts the answer from a JSON response using a dot-notation field path.
func extractAnswer(data []byte, fieldPath string) (string, error) {
	if fieldPath == "" {
		fieldPath = "response"
	}

	var raw interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return "", fmt.Errorf("parse JSON: %w", err)
	}

	parts := strings.Split(fieldPath, ".")
	current := raw

	for _, part := range parts {
		switch v := current.(type) {
		case map[string]interface{}:
			val, ok := v[part]
			if !ok {
				return "", fmt.Errorf("field %q not found in response", part)
			}
			current = val
		case []interface{}:
			idx := 0
			if _, err := fmt.Sscanf(part, "%d", &idx); err == nil && idx < len(v) {
				current = v[idx]
			} else {
				return "", fmt.Errorf("cannot index array with %q", part)
			}
		default:
			return "", fmt.Errorf("cannot navigate into %T at field %q", current, part)
		}
	}

	switch v := current.(type) {
	case string:
		return v, nil
	case float64:
		return fmt.Sprintf("%g", v), nil
	case bool:
		return fmt.Sprintf("%t", v), nil
	case nil:
		return "", fmt.Errorf("extracted value is null")
	default:
		b, _ := json.Marshal(v)
		return string(b), nil
	}
}
