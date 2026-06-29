package auth

import (
	"testing"
	"time"

	"github.com/notzeyyc/openx-v2/config"
)

func TestRateLimiterAllow(t *testing.T) {
	rl := NewRateLimiter(config.RateLimitConfig{
		Enabled:       true,
		WindowSeconds: 60,
		BurstSize:     5,
	})
	defer rl.Close()

	// First 5 requests should be allowed (burst)
	for i := 0; i < 5; i++ {
		if !rl.Allow("user1", 60) {
			t.Errorf("request %d should be allowed (within burst)", i+1)
		}
	}

	// 6th request should be denied (burst exhausted)
	if rl.Allow("user1", 60) {
		t.Error("6th request should be denied (burst exhausted)")
	}
}

func TestRateLimiterRefill(t *testing.T) {
	rl := NewRateLimiter(config.RateLimitConfig{
		Enabled:       true,
		WindowSeconds: 1,
		BurstSize:     2,
	})
	defer rl.Close()

	// Exhaust burst
	rl.Allow("user1", 120) // rate = 120/60 = 2/sec
	rl.Allow("user1", 120)

	// Should be denied
	if rl.Allow("user1", 120) {
		t.Error("should be denied after burst exhausted")
	}

	// Wait for refill (at 2/sec rate, 1 second should refill 2 tokens)
	time.Sleep(1100 * time.Millisecond)

	// Should be allowed again
	if !rl.Allow("user1", 120) {
		t.Error("should be allowed after refill")
	}
}

func TestRateLimiterDisabled(t *testing.T) {
	rl := NewRateLimiter(config.RateLimitConfig{
		Enabled:       false,
		WindowSeconds: 60,
		BurstSize:     1,
	})
	defer rl.Close()

	// All requests should be allowed when disabled
	for i := 0; i < 100; i++ {
		if !rl.Allow("user1", 1) {
			t.Errorf("request %d should be allowed when rate limiting is disabled", i+1)
		}
	}
}

func TestRateLimiterMultipleUsers(t *testing.T) {
	rl := NewRateLimiter(config.RateLimitConfig{
		Enabled:       true,
		WindowSeconds: 60,
		BurstSize:     2,
	})
	defer rl.Close()

	// User1 exhausts their burst
	rl.Allow("user1", 60)
	rl.Allow("user1", 60)

	// User2 should still have their own burst
	if !rl.Allow("user2", 60) {
		t.Error("user2 should have their own rate limit bucket")
	}
}

func TestRateLimiterReset(t *testing.T) {
	rl := NewRateLimiter(config.RateLimitConfig{
		Enabled:       true,
		WindowSeconds: 60,
		BurstSize:     2,
	})
	defer rl.Close()

	// Exhaust burst
	rl.Allow("user1", 60)
	rl.Allow("user1", 60)

	// Reset
	rl.Reset("user1")

	// Should be allowed again (new bucket)
	if !rl.Allow("user1", 60) {
		t.Error("should be allowed after reset")
	}
}

func TestRateLimiterBucketCount(t *testing.T) {
	rl := NewRateLimiter(config.RateLimitConfig{
		Enabled:       true,
		WindowSeconds: 60,
		BurstSize:     10,
	})
	defer rl.Close()

	rl.Allow("user1", 60)
	rl.Allow("user2", 60)
	rl.Allow("user3", 60)

	if count := rl.BucketCount(); count != 3 {
		t.Errorf("bucket count = %d, want 3", count)
	}
}
