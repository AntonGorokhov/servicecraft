package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/vetkb/backend/internal/models"
	"github.com/vetkb/backend/internal/services"
)

type ArticleHandler struct {
	articleService *services.ArticleService
}

func NewArticleHandler(s *services.ArticleService) *ArticleHandler {
	return &ArticleHandler{articleService: s}
}

// getCompanyID extracts companyID from gin context.
// Returns nil for superadmin (no company), pointer for company users.
func getCompanyID(c *gin.Context) *uint {
	val, exists := c.Get("companyID")
	if !exists {
		return nil
	}
	id := val.(uint)
	return &id
}

func isAdmin(c *gin.Context) bool {
	role, _ := c.Get("userRole")
	r, _ := role.(string)
	return r == "admin" || r == "superadmin"
}

func (h *ArticleHandler) List(c *gin.Context) {
	companyID := getCompanyID(c)

	articles, err := h.articleService.List(companyID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, articles)
}

func (h *ArticleHandler) GetBySlug(c *gin.Context) {
	slug := c.Param("slug")
	companyID := getCompanyID(c)

	article, err := h.articleService.GetBySlug(companyID, slug)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if article == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Article not found"})
		return
	}

	c.JSON(http.StatusOK, article)
}

type createArticleRequest struct {
	CompanyID *uint           `json:"company_id"`
	Slug      string          `json:"slug" binding:"required"`
	Name      string          `json:"name" binding:"required"`
	Category  string          `json:"category" binding:"required"`
	CallCount int             `json:"call_count"`
	Steps     int             `json:"steps"`
	Exceptions int            `json:"exceptions"`
	LastUpdated string        `json:"last_updated"`
	Content   json.RawMessage `json:"content"`
}

func (h *ArticleHandler) Create(c *gin.Context) {
	if !isAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Admin access required"})
		return
	}

	var req createArticleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Admin can only create in their own company
	role, _ := c.Get("userRole")
	companyID := getCompanyID(c)
	if role.(string) == "admin" {
		if companyID == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Admin must belong to a company"})
			return
		}
		req.CompanyID = companyID
	}

	article := models.Article{
		CompanyID:   req.CompanyID,
		Slug:        req.Slug,
		Name:        req.Name,
		Category:    req.Category,
		CallCount:   req.CallCount,
		Steps:       req.Steps,
		Exceptions:  req.Exceptions,
		LastUpdated: req.LastUpdated,
		Content:     req.Content,
	}

	if err := h.articleService.Create(&article); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, article)
}

func (h *ArticleHandler) Update(c *gin.Context) {
	if !isAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Admin access required"})
		return
	}

	slug := c.Param("slug")

	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Admin scoped to their company, superadmin can update any
	role, _ := c.Get("userRole")
	var companyID *uint
	if role.(string) == "admin" {
		companyID = getCompanyID(c)
	}

	article, err := h.articleService.Update(companyID, slug, body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, article)
}

func (h *ArticleHandler) Delete(c *gin.Context) {
	if !isAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Admin access required"})
		return
	}

	slug := c.Param("slug")

	// Admin scoped to their company
	role, _ := c.Get("userRole")
	var companyID *uint
	if role.(string) == "admin" {
		companyID = getCompanyID(c)
	}

	if err := h.articleService.Delete(companyID, slug); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Article deleted"})
}
