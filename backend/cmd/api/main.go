package main

import (
	"log"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/vetkb/backend/internal/config"
	"github.com/vetkb/backend/internal/database"
	"github.com/vetkb/backend/internal/handlers"
	"github.com/vetkb/backend/internal/middleware"
	"github.com/vetkb/backend/internal/models"
	"github.com/vetkb/backend/internal/pipeline"
	"github.com/vetkb/backend/internal/services"
)

func main() {
	cfg := config.Load()
	db := database.Connect(cfg)

	// AutoMigrate
	if err := db.AutoMigrate(&models.Company{}, &models.User{}, &models.Article{}); err != nil {
		log.Fatalf("AutoMigrate failed: %v", err)
	}

	// Seed
	models.SeedAdmin(db, cfg.AdminEmail, cfg.AdminPassword)
	models.SeedArticles(db)

	// Services
	authService := services.NewAuthService(db, cfg.JWTSecret)
	companyService := services.NewCompanyService(db)
	articleService := services.NewArticleService(db)

	// Qdrant
	qdrantPort, _ := strconv.Atoi(cfg.QdrantPort)
	qdrantService, err := pipeline.NewQdrantService(cfg.QdrantHost, qdrantPort)
	if err != nil {
		log.Fatalf("Qdrant init failed: %v", err)
	}
	defer qdrantService.Close()

	// Pipeline
	pipelineService := pipeline.NewPipelineService(cfg.ReplicateToken, qdrantService, articleService)

	// Handlers
	authHandler := handlers.NewAuthHandler(authService)
	profileHandler := handlers.NewProfileHandler(authService)
	companyHandler := handlers.NewCompanyHandler(companyService)
	articleHandler := handlers.NewArticleHandler(articleService)
	pipelineHandler := handlers.NewPipelineHandler(pipelineService)

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
	protected.PUT("/auth/profile", profileHandler.UpdateProfile)
	protected.PUT("/auth/password", profileHandler.ChangePassword)

	// Article routes (authenticated)
	protected.GET("/articles", articleHandler.List)
	protected.GET("/articles/:slug", articleHandler.GetBySlug)
	protected.POST("/articles", articleHandler.Create)
	protected.PUT("/articles/:slug", articleHandler.Update)
	protected.DELETE("/articles/:slug", articleHandler.Delete)

	// Pipeline routes (admin or superadmin)
	protected.POST("/pipeline/process", pipelineHandler.Process)

	// Superadmin routes
	admin := protected.Group("/admin")
	admin.Use(middleware.SuperadminRequired())
	admin.POST("/companies", companyHandler.Create)
	admin.GET("/companies", companyHandler.List)
	admin.DELETE("/companies/:id", companyHandler.Delete)
	admin.POST("/companies/:id/users", companyHandler.CreateUser)
	admin.GET("/companies/:id/users", companyHandler.ListUsers)

	if err := r.Run(":8080"); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
