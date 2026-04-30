package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type HealthHandler struct {
	db        *gorm.DB
	qdrantURL string
	startTime time.Time
}

func NewHealthHandler(db *gorm.DB, qdrantURL string) *HealthHandler {
	return &HealthHandler{
		db:        db,
		qdrantURL: qdrantURL,
		startTime: time.Now(),
	}
}

type serviceStatus struct {
	Status  string `json:"status"`
	Latency string `json:"latency,omitempty"`
	Error   string `json:"error,omitempty"`
}

func (h *HealthHandler) Check(c *gin.Context) {
	result := gin.H{
		"status": "ok",
		"uptime": time.Since(h.startTime).String(),
	}

	services := make(map[string]serviceStatus)

	pgStart := time.Now()
	sqlDB, err := h.db.DB()
	if err != nil {
		services["postgres"] = serviceStatus{Status: "error", Error: err.Error()}
	} else if err := sqlDB.Ping(); err != nil {
		services["postgres"] = serviceStatus{Status: "error", Error: err.Error()}
	} else {
		services["postgres"] = serviceStatus{Status: "ok", Latency: time.Since(pgStart).String()}
	}

	qdrantStart := time.Now()
	resp, err := http.Get(h.qdrantURL + "/healthz")
	if err != nil {
		services["qdrant"] = serviceStatus{Status: "error", Error: err.Error()}
	} else {
		resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			services["qdrant"] = serviceStatus{Status: "ok", Latency: time.Since(qdrantStart).String()}
		} else {
			services["qdrant"] = serviceStatus{Status: "degraded", Error: resp.Status}
		}
	}

	result["services"] = services

	for _, svc := range services {
		if svc.Status == "error" {
			result["status"] = "degraded"
			break
		}
	}

	status := http.StatusOK
	if result["status"] == "degraded" {
		status = http.StatusServiceUnavailable
	}

	c.JSON(status, result)
}

func (h *HealthHandler) Ready(c *gin.Context) {
	sqlDB, err := h.db.DB()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ready": false, "error": err.Error()})
		return
	}
	if err := sqlDB.Ping(); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ready": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ready": true})
}
