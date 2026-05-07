package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/vetkb/backend/internal/services"
	"gorm.io/gorm"
)

type AnalyticsHandler struct {
	db           *gorm.DB
	auditService *services.AuditService
}

func NewAnalyticsHandler(db *gorm.DB, auditService *services.AuditService) *AnalyticsHandler {
	return &AnalyticsHandler{db: db, auditService: auditService}
}

func (h *AnalyticsHandler) AuditLog(c *gin.Context) {
	companyID := extractCompanyID(c)
	filter := services.AuditFilter{CompanyID: companyID, Action: c.Query("action"), Resource: c.Query("resource")}
	if l := c.Query("limit"); l != "" {
		filter.Limit, _ = strconv.Atoi(l)
	}
	if o := c.Query("offset"); o != "" {
		filter.Offset, _ = strconv.Atoi(o)
	}
	if sd := c.Query("start_date"); sd != "" {
		if t, err := time.Parse("2006-01-02", sd); err == nil {
			filter.StartDate = &t
		}
	}

	logs, total, err := h.auditService.List(filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": logs, "total": total})
}

func (h *AnalyticsHandler) AuditStats(c *gin.Context) {
	companyID := extractCompanyID(c)
	days := 30
	if d := c.Query("days"); d != "" {
		if parsed, err := strconv.Atoi(d); err == nil && parsed > 0 {
			days = parsed
		}
	}
	stats, err := h.auditService.Stats(companyID, days)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, stats)
}

type KBStats struct {
	TotalArticles  int64          `json:"total_articles"`
	TotalCallCount int64          `json:"total_call_count"`
	ByCategory     []CategoryStat `json:"by_category"`
	MostAccessed   []ArticleStat  `json:"most_accessed"`
}

type CategoryStat struct {
	Category string `json:"category"`
	Count    int64  `json:"count"`
}

type ArticleStat struct {
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	Category  string `json:"category"`
	CallCount int    `json:"call_count"`
}

func (h *AnalyticsHandler) KBOverview(c *gin.Context) {
	companyID := extractCompanyID(c)
	stats := KBStats{}

	q := h.db.Table("articles").Where("deleted_at IS NULL")
	if companyID != nil {
		q = q.Where("company_id = ?", *companyID)
	}
	q.Count(&stats.TotalArticles)

	var totalCalls struct{ Sum int64 }
	q.Select("COALESCE(SUM(call_count), 0) as sum").Scan(&totalCalls)
	stats.TotalCallCount = totalCalls.Sum

	q.Select("category, count(*) as count").Group("category").Order("count DESC").Scan(&stats.ByCategory)

	q2 := h.db.Table("articles").Where("deleted_at IS NULL")
	if companyID != nil {
		q2 = q2.Where("company_id = ?", *companyID)
	}
	q2.Select("slug, name, category, call_count").Order("call_count DESC").Limit(10).Scan(&stats.MostAccessed)

	c.JSON(http.StatusOK, stats)
}
