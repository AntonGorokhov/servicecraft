package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

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

// qIndexer implements services.QuestionIndexer using pipeline + qdrant + bm25.
type qIndexer struct {
	pipelineSvc *pipeline.PipelineService
	qdrantSvc   *pipeline.QdrantService
	bm25        *pipeline.BM25Encoder
}

func (i *qIndexer) IndexQuestion(questionID uint, question, answer, themeName string, frequency int, companyID *uint) error {
	text := fmt.Sprintf("Q: %s A: %s", question, answer)
	denseVec, err := i.pipelineSvc.GetEmbedding(text)
	if err != nil {
		return fmt.Errorf("embed: %w", err)
	}
	sparseVec := i.bm25.Encode(text)
	return i.qdrantSvc.UpsertQA(questionID, question, answer, themeName, frequency, companyID, denseVec, sparseVec)
}

func main() {
	cfg := config.Load()
	db := database.Connect(cfg)

	// AutoMigrate
	if err := db.AutoMigrate(&models.Company{}, &models.User{}, &models.Article{}, &models.Comment{}, &models.ChatSession{}, &models.ChatMessage{}, &models.TranscriptionCache{}, &models.TTSCache{}, &models.FAQ{}, &models.Question{}, &models.ArticleVersion{}, &models.Webhook{}, &models.WebhookDelivery{}, &models.AuditLog{}); err != nil {
		log.Fatalf("AutoMigrate failed: %v", err)
	}

	// Seed
	models.SeedAdmin(db, cfg.AdminEmail, cfg.AdminPassword)
	models.SeedArticles(db)
	models.SeedFAQ(db)

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
	faqService := services.NewFAQService(db)
	versionService := services.NewArticleVersionService(db)
	webhookService := services.NewWebhookService(db)
	auditService := services.NewAuditService(db)
	exportService := services.NewExportService(db, articleService)
	searchService := services.NewSearchService(db)

	// Qdrant
	qdrantPort, _ := strconv.Atoi(cfg.QdrantPort)
	qdrantService, err := pipeline.NewQdrantService(cfg.QdrantHost, qdrantPort)
	if err != nil {
		log.Fatalf("Qdrant init failed: %v", err)
	}
	defer qdrantService.Close()

	if err := qdrantService.EnsureQACollection(); err != nil {
		log.Fatalf("QA collection init failed: %v", err)
	}

	// Pipeline
	pipelineService := pipeline.NewPipelineService(cfg.ReplicateToken, cfg.OpenAIAPIKey, db, qdrantService, articleService, priceService)

	// BM25 encoder — built from all questions in DB
	var bm25Corpus []string
	var allQuestions []struct{ Question, Answer string }
	db.Model(&models.Question{}).Select("question, answer").Find(&allQuestions)
	for _, q := range allQuestions {
		text := "Q: " + q.Question
		if q.Answer != "" {
			text += " A: " + q.Answer
		}
		bm25Corpus = append(bm25Corpus, text)
	}
	bm25Encoder := pipeline.NewBM25Encoder(bm25Corpus)
	log.Printf("[bm25] encoder built: vocab=%d terms, corpus=%d docs", bm25Encoder.VocabSize(), len(bm25Corpus))

	questionService := services.NewQuestionService(db, &qIndexer{pipelineSvc: pipelineService, qdrantSvc: qdrantService, bm25: bm25Encoder})

	// Agent (YandexGPT)
	yandexClient := agent.NewYandexGPTClient(cfg.YandexGPTAPIKey, cfg.YandexGPTFolderID, cfg.YandexGPTModel)
	agentService := agent.NewAgentService(qdrantService, articleService, priceService, pipelineService, yandexClient, chatService, faqService, bm25Encoder)

	// Handlers
	authHandler := handlers.NewAuthHandler(authService)
	profileHandler := handlers.NewProfileHandler(authService)
	companyHandler := handlers.NewCompanyHandler(companyService)
	articleHandler := handlers.NewArticleHandler(articleService)
	commentHandler := handlers.NewCommentHandler(commentService, articleService)
	pipelineHandler := handlers.NewPipelineHandler(pipelineService, articleService, db)
	priceHandler := handlers.NewPriceHandler(priceService)
	faqHandler := handlers.NewFAQHandler(faqService)
	agentHandler := handlers.NewAgentHandler(agentService, chatService, db, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret, cfg.LiveKitURL)
	questionHandler := handlers.NewQuestionHandler(questionService)
	yclientsHandler := handlers.NewYClientsHandler()

	qdrantURL := fmt.Sprintf("http://%s:%s", cfg.QdrantHost, cfg.QdrantPort)
	healthHandler := handlers.NewHealthHandler(db, qdrantURL)
	versionHandler := handlers.NewArticleVersionHandler(versionService, articleService)
	webhookHandler := handlers.NewWebhookHandler(webhookService)
	exportHandler := handlers.NewExportHandler(exportService)
	batchHandler := handlers.NewBatchHandler(pipelineService)
	analyticsHandler := handlers.NewAnalyticsHandler(db, auditService)
	searchHandler := handlers.NewSearchHandler(searchService)

	r := gin.Default()
	r.Use(middleware.CORS())
	r.Use(middleware.RequestLogger())
	r.Use(middleware.RateLimit(120))

	// Public routes
	api := r.Group("/api")
	api.GET("/health", healthHandler.Check)
	api.GET("/ready", healthHandler.Ready)

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

	// FAQ routes (authenticated)
	protected.GET("/faq", faqHandler.List)
	protected.GET("/faq/:slug", faqHandler.GetBySlug)
	protected.POST("/faq", faqHandler.Create)
	protected.PUT("/faq/:slug", faqHandler.Update)
	protected.DELETE("/faq/:slug", faqHandler.Delete)

	// Article version routes (authenticated)
	protected.GET("/articles/:slug/versions", versionHandler.ListVersions)
	protected.GET("/articles/:slug/versions/:version", versionHandler.GetVersion)
	protected.GET("/articles/:slug/versions/diff", versionHandler.DiffVersions)
	protected.POST("/articles/:slug/versions/:version/restore", versionHandler.RestoreVersion)

	// Comment routes (authenticated)
	protected.GET("/articles/:slug/comments", commentHandler.List)
	protected.POST("/articles/:slug/comments", commentHandler.Create)
	protected.DELETE("/articles/:slug/comments/:id", commentHandler.Delete)

	// Search routes (authenticated)
	protected.GET("/search", searchHandler.Search)
	protected.GET("/knowledge-graph", searchHandler.KnowledgeGraph)

	// Analytics routes (authenticated)
	protected.GET("/analytics/kb", analyticsHandler.KBOverview)
	protected.GET("/analytics/audit", analyticsHandler.AuditLog)
	protected.GET("/analytics/audit/stats", analyticsHandler.AuditStats)

	// Export/Import routes (authenticated)
	protected.GET("/export/json", exportHandler.ExportJSON)
	protected.GET("/export/csv", exportHandler.ExportCSV)
	protected.POST("/import/json", exportHandler.ImportJSON)

	// Batch pipeline processing (admin)
	protected.POST("/pipeline/batch", batchHandler.ProcessBatch)

	// Webhook routes (admin)
	protected.GET("/webhooks", webhookHandler.List)
	protected.POST("/webhooks", webhookHandler.Create)
	protected.PUT("/webhooks/:id", webhookHandler.Update)
	protected.DELETE("/webhooks/:id", webhookHandler.Delete)
	protected.GET("/webhooks/:id/deliveries", webhookHandler.Deliveries)

	// Pipeline routes (admin or superadmin)
	protected.POST("/pipeline/process", pipelineHandler.Process)

	// Audio and transcript routes (authenticated)
	protected.GET("/audio/:call_id", pipelineHandler.AudioClip)
	protected.GET("/transcript/:call_id/segments", pipelineHandler.TranscriptSegments)

	// Agent routes (authenticated)
	protected.POST("/agent/chat", agentHandler.Chat)
	protected.POST("/agent/tts", agentHandler.TTS)
	protected.GET("/agent/sessions", agentHandler.ListSessions)
	protected.GET("/agent/sessions/:id/messages", agentHandler.GetMessages)
	protected.DELETE("/agent/sessions/:id", agentHandler.DeleteSession)

	// Company settings (authenticated, own company)
	protected.GET("/settings", companyHandler.GetSettings)
	protected.PUT("/settings", companyHandler.UpdateSettings)

	// YClients CRM routes (authenticated)
	protected.GET("/yclients/slots", yclientsHandler.GetSlots)
	protected.POST("/yclients/book", yclientsHandler.Book)
	protected.GET("/yclients/patient/:phone", yclientsHandler.GetPatient)

	// Question queue routes (admin+)
	protected.GET("/questions", questionHandler.List)
	protected.GET("/questions/stats", questionHandler.Stats)
	protected.GET("/questions/themes", questionHandler.Themes)
	protected.POST("/questions/import", questionHandler.Import)
	protected.GET("/questions/export", questionHandler.Export)
	protected.PUT("/questions/:id/answer", questionHandler.SaveAnswer)
	protected.POST("/questions/:id/accept-draft", questionHandler.AcceptDraft)
	protected.POST("/questions/reindex", questionHandler.Reindex)

	// Superadmin routes
	admin := protected.Group("/admin")
	admin.Use(middleware.SuperadminRequired())
	admin.POST("/companies", companyHandler.Create)
	admin.GET("/companies", companyHandler.List)
	admin.DELETE("/companies/:id", companyHandler.Delete)
	admin.POST("/companies/:id/users", companyHandler.CreateUser)
	admin.GET("/companies/:id/users", companyHandler.ListUsers)

	srv := &http.Server{
		Addr:    ":8080",
		Handler: r,
	}

	go func() {
		log.Println("Starting server on :8080")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}
	log.Println("Server exited")
}
