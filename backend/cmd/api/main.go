package main

import (
	"log"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/vetkb/backend/internal/agent"
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
	if err := db.AutoMigrate(&models.Company{}, &models.User{}, &models.Article{}, &models.Comment{}, &models.ChatSession{}, &models.ChatMessage{}); err != nil {
		log.Fatalf("AutoMigrate failed: %v", err)
	}

	// Seed
	models.SeedAdmin(db, cfg.AdminEmail, cfg.AdminPassword)
	models.SeedArticles(db)

	// Price tree
	priceTree, err := services.LoadPriceTree("price-tree.yaml")
	if err != nil {
		log.Fatalf("Failed to load price tree: %v", err)
	}
	priceService := services.NewPriceService(priceTree)
	log.Printf("Loaded price tree: %d categories, %d services indexed", len(priceTree), len(priceService.GetTree()))

	// Services
	authService := services.NewAuthService(db, cfg.JWTSecret)
	companyService := services.NewCompanyService(db)
	articleService := services.NewArticleService(db)
	commentService := services.NewCommentService(db)
	chatService := services.NewChatService(db)

	// Qdrant
	qdrantPort, _ := strconv.Atoi(cfg.QdrantPort)
	qdrantService, err := pipeline.NewQdrantService(cfg.QdrantHost, qdrantPort)
	if err != nil {
		log.Fatalf("Qdrant init failed: %v", err)
	}
	defer qdrantService.Close()

	// Pipeline
	pipelineService := pipeline.NewPipelineService(cfg.ReplicateToken, cfg.OpenAIAPIKey, qdrantService, articleService, priceService)

	// Agent (YandexGPT)
	yandexClient := agent.NewYandexGPTClient(cfg.YandexGPTAPIKey, cfg.YandexGPTFolderID, cfg.YandexGPTModel)
	agentService := agent.NewAgentService(qdrantService, articleService, priceService, pipelineService, yandexClient, chatService)

	// Handlers
	authHandler := handlers.NewAuthHandler(authService)
	profileHandler := handlers.NewProfileHandler(authService)
	companyHandler := handlers.NewCompanyHandler(companyService)
	articleHandler := handlers.NewArticleHandler(articleService)
	commentHandler := handlers.NewCommentHandler(commentService, articleService)
	pipelineHandler := handlers.NewPipelineHandler(pipelineService)
	priceHandler := handlers.NewPriceHandler(priceService)
	agentHandler := handlers.NewAgentHandler(agentService, chatService, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret, cfg.LiveKitURL)

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

	// Internal routes (no auth — Docker network isolation only)
	api.POST("/agent/rag", agentHandler.RAG)
	api.POST("/agent/rag/stream", agentHandler.RAGStream)
	api.POST("/agent/context", agentHandler.Context)
	api.GET("/agent/articles", agentHandler.ListArticlesInternal)
	api.POST("/agent/token", agentHandler.Token)
	api.POST("/reindex", pipelineHandler.Reindex)

	// Protected routes
	protected := api.Group("")
	protected.Use(middleware.AuthRequired(authService))
	protected.GET("/auth/me", authHandler.Me)
	protected.PUT("/auth/profile", profileHandler.UpdateProfile)
	protected.PUT("/auth/password", profileHandler.ChangePassword)

	// Price tree (authenticated)
	protected.GET("/price-tree", priceHandler.GetTree)

	// Article routes (authenticated)
	protected.GET("/articles", articleHandler.List)
	protected.GET("/articles/:slug", articleHandler.GetBySlug)
	protected.POST("/articles", articleHandler.Create)
	protected.PUT("/articles/:slug", articleHandler.Update)
	protected.DELETE("/articles/:slug", articleHandler.Delete)

	// Comment routes (authenticated)
	protected.GET("/articles/:slug/comments", commentHandler.List)
	protected.POST("/articles/:slug/comments", commentHandler.Create)
	protected.DELETE("/articles/:slug/comments/:id", commentHandler.Delete)

	// Pipeline routes (admin or superadmin)
	protected.POST("/pipeline/process", pipelineHandler.Process)

	// Agent routes (authenticated)
	protected.POST("/agent/chat", agentHandler.Chat)
	protected.GET("/agent/sessions", agentHandler.ListSessions)
	protected.GET("/agent/sessions/:id/messages", agentHandler.GetMessages)
	protected.DELETE("/agent/sessions/:id", agentHandler.DeleteSession)

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
