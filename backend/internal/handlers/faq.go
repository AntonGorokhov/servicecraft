package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/vetkb/backend/internal/models"
	"github.com/vetkb/backend/internal/services"
)

type FAQHandler struct {
	faqService *services.FAQService
}

func NewFAQHandler(s *services.FAQService) *FAQHandler {
	return &FAQHandler{faqService: s}
}

// List returns all FAQ entries for the user's company.
func (h *FAQHandler) List(c *gin.Context) {
	companyID := getCompanyID(c)
	faqs, err := h.faqService.List(companyID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, faqs)
}

// GetBySlug returns a single FAQ entry.
func (h *FAQHandler) GetBySlug(c *gin.Context) {
	companyID := getCompanyID(c)
	slug := c.Param("slug")
	faq, err := h.faqService.GetBySlug(companyID, slug)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if faq == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "FAQ not found"})
		return
	}
	c.JSON(http.StatusOK, faq)
}

// Create creates a new FAQ entry (admin+).
func (h *FAQHandler) Create(c *gin.Context) {
	companyID := getCompanyID(c)
	var input struct {
		Slug     string          `json:"slug" binding:"required"`
		Title    string          `json:"title" binding:"required"`
		Category string          `json:"category" binding:"required"`
		Priority int             `json:"priority"`
		Content  json.RawMessage `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	faq := &models.FAQ{
		CompanyID: companyID,
		Slug:      input.Slug,
		Title:     input.Title,
		Category:  input.Category,
		Priority:  input.Priority,
		Content:   input.Content,
	}
	if err := h.faqService.Create(faq); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, faq)
}

// Update updates a FAQ entry (admin+).
func (h *FAQHandler) Update(c *gin.Context) {
	companyID := getCompanyID(c)
	slug := c.Param("slug")
	var updates map[string]interface{}
	if err := c.ShouldBindJSON(&updates); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	faq, err := h.faqService.Update(companyID, slug, updates)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, faq)
}

// Delete deletes a FAQ entry (admin+).
func (h *FAQHandler) Delete(c *gin.Context) {
	companyID := getCompanyID(c)
	slug := c.Param("slug")
	if err := h.faqService.Delete(companyID, slug); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}
