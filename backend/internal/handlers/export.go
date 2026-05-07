package handlers

import (
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/vetkb/backend/internal/services"
)

type ExportHandler struct {
	exportService *services.ExportService
}

func NewExportHandler(es *services.ExportService) *ExportHandler {
	return &ExportHandler{exportService: es}
}

func (h *ExportHandler) ExportJSON(c *gin.Context) {
	companyID := extractCompanyID(c)
	data, err := h.exportService.ExportJSON(companyID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	filename := fmt.Sprintf("kb-export-%s.json", time.Now().Format("2006-01-02"))
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))
	c.Data(http.StatusOK, "application/json", data)
}

func (h *ExportHandler) ExportCSV(c *gin.Context) {
	companyID := extractCompanyID(c)
	filename := fmt.Sprintf("kb-export-%s.csv", time.Now().Format("2006-01-02"))
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Stream(func(w io.Writer) bool {
		h.exportService.ExportCSV(companyID, w)
		return false
	})
}

func (h *ExportHandler) ImportJSON(c *gin.Context) {
	companyID := extractCompanyID(c)
	file, _, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file required"})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, 50*1024*1024))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read file"})
		return
	}

	overwrite := c.Query("overwrite") == "true"
	result, err := h.exportService.ImportJSON(data, companyID, overwrite)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}
