package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/vetkb/backend/internal/services"
)

type SearchHandler struct {
	searchService *services.SearchService
}

func NewSearchHandler(ss *services.SearchService) *SearchHandler {
	return &SearchHandler{searchService: ss}
}

func (h *SearchHandler) Search(c *gin.Context) {
	companyID := extractCompanyID(c)
	query := c.Query("q")
	if query == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "query parameter 'q' is required"})
		return
	}

	category := c.Query("category")
	limit := 20
	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil {
			limit = parsed
		}
	}

	results, err := h.searchService.Search(companyID, query, category, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"query": query, "count": len(results), "results": results})
}

func (h *SearchHandler) KnowledgeGraph(c *gin.Context) {
	companyID := extractCompanyID(c)
	links, err := h.searchService.BuildKnowledgeGraph(companyID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"links": links, "count": len(links)})
}
