package auth

import (
	"math"
	"sync"
	"time"

	"github.com/notzeyyc/openx-v2/config"
	"github.com/notzeyyc/openx-v2/pkg/logging"
)

// TokenBucket implements the token bucket rate limiting algorithm.
type TokenBucket struct {
	tokens     float64
	lastRefill time.Time
	rate       float64 // tokens per second
	burst      float64 // max tokens (burst size)
}

// RateLimiter provides per-principal rate limiting using token buckets.
// It includes periodic cleanup to prevent unbounded memory growth.
type RateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*TokenBucket
	config  config.RateLimitConfig
	logger  *logging.Logger
	done    chan struct{}
}

// NewRateLimiter creates a new rate limiter with the given configuration.
func NewRateLimiter(cfg config.RateLimitConfig) *RateLimiter {
	rl := &RateLimiter{
		buckets: make(map[string]*TokenBucket),
		config:  cfg,
		logger:  logging.GetLogger("rate_limiter"),
		done:    make(chan struct{}),
	}

	// Start periodic cleanup to prevent memory leaks from stale buckets
	go rl.periodicCleanup()

	return rl
}

// Allow checks if a request from the given principal is allowed.
// Returns true if allowed, false if rate limited.
func (rl *RateLimiter) Allow(principalName string, customRate int) bool {
	if !rl.config.Enabled {
		return true
	}

	rl.mu.Lock()
	defer rl.mu.Unlock()

	bucket, exists := rl.buckets[principalName]
	if !exists {
		// Create new bucket for this principal
		rate := float64(customRate) / 60.0 // Convert per-minute to per-second
		if rate <= 0 {
			rate = float64(rl.config.BurstSize) / float64(rl.config.WindowSeconds)
		}

		burst := float64(rl.config.BurstSize)
		if burst <= 0 {
			burst = 10
		}

		bucket = &TokenBucket{
			tokens:     burst, // Start full
			lastRefill: time.Now(),
			rate:       rate,
			burst:      burst,
		}
		rl.buckets[principalName] = bucket
	}

	// Refill tokens based on elapsed time
	now := time.Now()
	elapsed := now.Sub(bucket.lastRefill).Seconds()
	bucket.tokens = math.Min(
		bucket.burst,
		bucket.tokens+(elapsed*bucket.rate),
	)
	bucket.lastRefill = now

	// Check if we have a token to consume
	if bucket.tokens >= 1.0 {
		bucket.tokens -= 1.0
		return true
	}

	rl.logger.Warnf("rate limited: %s (tokens: %.2f)", principalName, bucket.tokens)
	return false
}

// Reset removes the rate limit state for a principal.
func (rl *RateLimiter) Reset(principalName string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	delete(rl.buckets, principalName)
}

// periodicCleanup removes stale buckets every 10 minutes to prevent memory leaks.
func (rl *RateLimiter) periodicCleanup() {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-rl.done:
			return
		case <-ticker.C:
			rl.cleanup()
		}
	}
}

// cleanup removes buckets that haven't been used in over 1 hour.
func (rl *RateLimiter) cleanup() {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	cutoff := time.Now().Add(-1 * time.Hour)
	removed := 0

	for name, bucket := range rl.buckets {
		if bucket.lastRefill.Before(cutoff) {
			delete(rl.buckets, name)
			removed++
		}
	}

	if removed > 0 {
		rl.logger.Debugf("cleaned up %d stale rate limit buckets", removed)
	}
}

// Close stops the periodic cleanup goroutine.
func (rl *RateLimiter) Close() {
	close(rl.done)
}

// BucketCount returns the number of active buckets (for monitoring).
func (rl *RateLimiter) BucketCount() int {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	return len(rl.buckets)
}
