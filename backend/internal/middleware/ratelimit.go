package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type rateLimiter struct {
	mu       sync.Mutex
	tokens   map[string]*bucket
	rate     int
	interval time.Duration
}

type bucket struct {
	tokens    int
	lastReset time.Time
}

func RateLimit(requestsPerMinute int) gin.HandlerFunc {
	rl := &rateLimiter{
		tokens:   make(map[string]*bucket),
		rate:     requestsPerMinute,
		interval: time.Minute,
	}

	go rl.cleanup()

	return func(c *gin.Context) {
		key := c.ClientIP()

		if !rl.allow(key) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":       "rate limit exceeded",
				"retry_after": "60s",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

func (rl *rateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	b, exists := rl.tokens[key]
	if !exists {
		rl.tokens[key] = &bucket{
			tokens:    rl.rate - 1,
			lastReset: time.Now(),
		}
		return true
	}

	if time.Since(b.lastReset) > rl.interval {
		b.tokens = rl.rate - 1
		b.lastReset = time.Now()
		return true
	}

	if b.tokens > 0 {
		b.tokens--
		return true
	}

	return false
}

func (rl *rateLimiter) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		rl.mu.Lock()
		for key, b := range rl.tokens {
			if time.Since(b.lastReset) > 10*time.Minute {
				delete(rl.tokens, key)
			}
		}
		rl.mu.Unlock()
	}
}
