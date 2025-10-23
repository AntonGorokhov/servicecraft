package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/vetkb/backend/internal/models"
	"github.com/vetkb/backend/internal/services"
)

type CommentHandler struct {
	commentService *services.CommentService
	articleService *services.ArticleService
}

func NewCommentHandler(cs *services.CommentService, as *services.ArticleService) *CommentHandler {
	return &CommentHandler{commentService: cs, articleService: as}
}

func (h *CommentHandler) List(c *gin.Context) {
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

	comments, err := h.commentService.ListByArticle(article.ID, companyID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, comments)
}

type createCommentRequest struct {
	QuotedText string `json:"quoted_text"`
	Body       string `json:"body" binding:"required"`
}

func (h *CommentHandler) Create(c *gin.Context) {
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

	var req createCommentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Body is required"})
		return
	}

	userID, _ := c.Get("userID")

	comment := models.Comment{
		ArticleID:  article.ID,
		UserID:     userID.(uint),
		CompanyID:  companyID,
		QuotedText: req.QuotedText,
		Body:       req.Body,
	}

	if err := h.commentService.Create(&comment); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, comment)
}

func (h *CommentHandler) Delete(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid comment ID"})
		return
	}

	userID, _ := c.Get("userID")
	companyID := getCompanyID(c)

	if err := h.commentService.Delete(uint(id), userID.(uint), companyID, isAdmin(c)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Comment deleted"})
}
