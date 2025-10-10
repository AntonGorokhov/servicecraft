package handlers

import (
	"encoding/base64"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/vetkb/backend/internal/pipeline"
)

type PipelineHandler struct {
	pipelineService *pipeline.PipelineService
}

func NewPipelineHandler(s *pipeline.PipelineService) *PipelineHandler {
	return &PipelineHandler{pipelineService: s}
}

// Process handles POST /api/pipeline/process
func (h *PipelineHandler) Process(c *gin.Context) {
	// Check role: admin or superadmin
	role, _ := c.Get("userRole")
	roleStr, _ := role.(string)
	if roleStr != "admin" && roleStr != "superadmin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Admin or superadmin access required"})
		return
	}

	// Read audio file from multipart form
	file, header, err := c.Request.FormFile("audio")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Audio file required (field: audio)"})
		return
	}
	defer file.Close()

	// Derive callID from filename (strip extension)
	callID := strings.TrimSuffix(header.Filename, filepath.Ext(header.Filename))

	audioBytes, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read audio file"})
		return
	}

	if len(audioBytes) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Audio file is empty"})
		return
	}

	// Determine company scope
	var companyID *uint
	if roleStr == "superadmin" {
		// Superadmin can optionally specify company_id
		if cidStr := c.PostForm("company_id"); cidStr != "" {
			cid, err := strconv.ParseUint(cidStr, 10, 32)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid company_id"})
				return
			}
			id := uint(cid)
			companyID = &id
		}
		// nil companyID = global articles
	} else {
		// Admin: scoped to their company
		companyID = getCompanyID(c)
		if companyID == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Admin must belong to a company"})
			return
		}
	}

	// Encode audio to base64
	audioBase64 := base64.StdEncoding.EncodeToString(audioBytes)

	// Run pipeline
	result, err := h.pipelineService.Process(audioBase64, companyID, callID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}
