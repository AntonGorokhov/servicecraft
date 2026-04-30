package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/vetkb/backend/internal/services"
)

type ArticleVersionHandler struct {
	versionService *services.ArticleVersionService
	articleService *services.ArticleService
}

func NewArticleVersionHandler(vs *services.ArticleVersionService, as *services.ArticleService) *ArticleVersionHandler {
	return &ArticleVersionHandler{versionService: vs, articleService: as}
}

func (h *ArticleVersionHandler) ListVersions(c *gin.Context) {
	slug := c.Param("slug")
	companyID := extractCompanyID(c)

	article, err := h.articleService.GetBySlug(companyID, slug)
	if err != nil || article == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "article not found"})
		return
	}

	versions, err := h.versionService.ListVersions(article.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, versions)
}

func (h *ArticleVersionHandler) GetVersion(c *gin.Context) {
	slug := c.Param("slug")
	versionStr := c.Param("version")
	companyID := extractCompanyID(c)

	article, err := h.articleService.GetBySlug(companyID, slug)
	if err != nil || article == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "article not found"})
		return
	}

	version, _ := strconv.Atoi(versionStr)
	v, err := h.versionService.GetVersion(article.ID, version)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "version not found"})
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *ArticleVersionHandler) DiffVersions(c *gin.Context) {
	slug := c.Param("slug")
	companyID := extractCompanyID(c)

	article, err := h.articleService.GetBySlug(companyID, slug)
	if err != nil || article == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "article not found"})
		return
	}

	v1, _ := strconv.Atoi(c.Query("v1"))
	v2, _ := strconv.Atoi(c.Query("v2"))
	if v1 == 0 || v2 == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "v1 and v2 required"})
		return
	}

	diffs, err := h.versionService.DiffVersions(article.ID, v1, v2)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"article_id": article.ID, "v1": v1, "v2": v2, "diffs": diffs})
}

func (h *ArticleVersionHandler) RestoreVersion(c *gin.Context) {
	slug := c.Param("slug")
	versionStr := c.Param("version")
	companyID := extractCompanyID(c)

	article, err := h.articleService.GetBySlug(companyID, slug)
	if err != nil || article == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "article not found"})
		return
	}

	version, _ := strconv.Atoi(versionStr)
	v, err := h.versionService.RestoreVersion(article.ID, version)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "version not found"})
		return
	}

	updates := map[string]interface{}{"content": v.Content}
	updated, err := h.articleService.Update(companyID, slug, updates)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, updated)
}

func extractCompanyID(c *gin.Context) *uint {
	val, exists := c.Get("company_id")
	if !exists {
		return nil
	}
	id, ok := val.(uint)
	if !ok {
		return nil
	}
	return &id
}
