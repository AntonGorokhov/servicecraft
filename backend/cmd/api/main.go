package main

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/vetkb/backend/internal/config"
	"github.com/vetkb/backend/internal/database"
	"github.com/vetkb/backend/internal/handlers"
	"github.com/vetkb/backend/internal/middleware"
	"github.com/vetkb/backend/internal/models"
	"github.com/vetkb/backend/internal/services"
)

func main() {
	cfg := config.Load()
	db := database.Connect(cfg)

	// AutoMigrate
	if err := db.AutoMigrate(&models.User{}); err != nil {
		log.Fatalf("AutoMigrate failed: %v", err)
	}

	// Seed admin user
	models.SeedAdmin(db, cfg.AdminEmail, cfg.AdminPassword)

	// Services
	authService := services.NewAuthService(db, cfg.JWTSecret)

	// Handlers
	authHandler := handlers.NewAuthHandler(authService)

	r := gin.Default()
	r.Use(middleware.CORS())

	// Public routes
	api := r.Group("/api")
	api.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	auth := api.Group("/auth")
	auth.POST("/login", authHandler.Login)
	auth.POST("/refresh", authHandler.Refresh)
	auth.POST("/logout", authHandler.Logout)

	// Protected routes
	protected := api.Group("")
	protected.Use(middleware.AuthRequired(authService))
	protected.GET("/auth/me", authHandler.Me)

	if err := r.Run(":8080"); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
