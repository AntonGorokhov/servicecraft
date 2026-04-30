package middleware

import (
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		query := c.Request.URL.RawQuery

		c.Next()

		latency := time.Since(start)
		status := c.Writer.Status()
		method := c.Request.Method
		clientIP := c.ClientIP()
		size := c.Writer.Size()

		if query != "" {
			path = path + "?" + query
		}

		log.Printf("[http] %s %s %d %s %s %d bytes",
			method, path, status, latency, clientIP, size)
	}
}
