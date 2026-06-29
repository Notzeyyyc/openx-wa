package browser

import (
	"testing"
)

func TestExtractText(t *testing.T) {
	tests := []struct {
		name     string
		html     string
		expected string
	}{
		{
			name:     "simple paragraph",
			html:     "<p>Hello World</p>",
			expected: "Hello World",
		},
		{
			name:     "nested tags",
			html:     "<div><p>Hello <strong>World</strong></p></div>",
			expected: "Hello World",
		},
		{
			name:     "script removal",
			html:     "<p>Text</p><script>alert('xss')</script><p>More</p>",
			expected: "TextMore",
		},
		{
			name:     "style removal",
			html:     "<style>.foo{color:red}</style><p>Content</p>",
			expected: "Content",
		},
		{
			name:     "html entities",
			html:     "<p>A &amp; B &lt; C &gt; D &quot;E&quot;</p>",
			expected: "A & B < C > D \"E\"",
		},
		{
			name:     "whitespace collapse",
			html:     "<p>  Hello   World  </p>",
			expected: "Hello World",
		},
		{
			name:     "empty input",
			html:     "",
			expected: "",
		},
		{
			name:     "no tags",
			html:     "plain text content",
			expected: "plain text content",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ExtractText(tt.html)
			if got != tt.expected {
				t.Errorf("ExtractText(%q) = %q, want %q", tt.html, got, tt.expected)
			}
		})
	}
}

func TestTruncate(t *testing.T) {
	tests := []struct {
		input    string
		maxLen   int
		expected string
	}{
		{"hello", 10, "hello"},
		{"hello world", 5, "hello..."},
		{"", 5, ""},
		{"abc", 3, "abc"},
	}

	for _, tt := range tests {
		got := truncate(tt.input, tt.maxLen)
		if got != tt.expected {
			t.Errorf("truncate(%q, %d) = %q, want %q", tt.input, tt.maxLen, got, tt.expected)
		}
	}
}
