package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/vetkb/backend/internal/services"
)

type QuestionHandler struct {
	questionService *services.QuestionService
}

func NewQuestionHandler(s *services.QuestionService) *QuestionHandler {
	return &QuestionHandler{questionService: s}
}

func (h *QuestionHandler) List(c *gin.Context) {
	companyID := getCompanyID(c)
	limit, _ := strconv.Atoi(c.Query("limit"))
	filter := services.ListQuestionsFilter{
		Status: c.Query("status"),
		Theme:  c.Query("theme"),
		Search: c.Query("search"),
		Limit:  limit,
	}
	questions, err := h.questionService.List(companyID, filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	type QResp struct {
		ID          uint            `json:"id"`
		ExternalID  string          `json:"external_id"`
		Question    string          `json:"question"`
		Answer      string          `json:"answer"`
		AIAnswer    string          `json:"ai_answer"`
		AIStatus    string          `json:"ai_status"`
		ThemeID     string          `json:"theme_id"`
		ThemeName   string          `json:"theme_name"`
		Frequency   int             `json:"frequency"`
		IsFAQ       bool            `json:"is_faq"`
		IsLocked    bool            `json:"is_locked"`
		Evidence    json.RawMessage `json:"evidence"`
		Status      string          `json:"status"`
		RagApproved bool            `json:"rag_approved"`
		IndexedAt   *time.Time      `json:"indexed_at"`
		CreatedAt   time.Time       `json:"created_at"`
		UpdatedAt   time.Time       `json:"updated_at"`
	}
	resp := make([]QResp, len(questions))
	for i, q := range questions {
		resp[i] = QResp{
			ID:          q.ID,
			ExternalID:  q.ExternalID,
			Question:    q.Question,
			Answer:      q.Answer,
			AIAnswer:    q.AIAnswer,
			AIStatus:    q.AIStatus,
			ThemeID:     q.ThemeID,
			ThemeName:   q.ThemeName,
			Frequency:   q.Frequency,
			IsFAQ:       q.IsFAQ,
			IsLocked:    q.IsLocked,
			Evidence:    q.Evidence,
			Status:      q.Status(),
			RagApproved: q.RagApproved,
			IndexedAt:   q.IndexedAt,
			CreatedAt:   q.CreatedAt,
			UpdatedAt:   q.UpdatedAt,
		}
	}
	c.JSON(http.StatusOK, resp)
}

func (h *QuestionHandler) Stats(c *gin.Context) {
	companyID := getCompanyID(c)
	stats, err := h.questionService.Stats(companyID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, stats)
}

func (h *QuestionHandler) Themes(c *gin.Context) {
	companyID := getCompanyID(c)
	themes, err := h.questionService.Themes(companyID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, themes)
}

func (h *QuestionHandler) SaveAnswer(c *gin.Context) {
	companyID := getCompanyID(c)
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var input struct {
		Answer string `json:"answer"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	q, err := h.questionService.SaveAnswer(companyID, uint(id), input.Answer)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, q)
}

func (h *QuestionHandler) AcceptDraft(c *gin.Context) {
	companyID := getCompanyID(c)
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	q, err := h.questionService.AcceptDraft(companyID, uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, q)
}

func (h *QuestionHandler) Import(c *gin.Context) {
	companyID := getCompanyID(c)
	var export services.KnowledgeOSExport
	if err := c.ShouldBindJSON(&export); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result, err := h.questionService.Import(companyID, &export)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *QuestionHandler) Reindex(c *gin.Context) {
	companyID := getCompanyID(c)
	count, err := h.questionService.ReindexAll(companyID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"indexed": count})
}

func (h *QuestionHandler) Export(c *gin.Context) {
	companyID := getCompanyID(c)
	export, err := h.questionService.Export(companyID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	filename := fmt.Sprintf("vetkb-export-%s.json", time.Now().Format("2006-01-02"))
	c.Header("Content-Disposition", "attachment; filename="+filename)
	c.JSON(http.StatusOK, export)
}
