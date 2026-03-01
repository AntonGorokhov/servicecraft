package handlers

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/vetkb/backend/internal/models"
	"github.com/vetkb/backend/internal/pipeline"
	"github.com/vetkb/backend/internal/services"
	"gorm.io/gorm"
)

type PipelineHandler struct {
	pipelineService *pipeline.PipelineService
	articleService  *services.ArticleService
	db              *gorm.DB
}

func NewPipelineHandler(s *pipeline.PipelineService, as *services.ArticleService, db *gorm.DB) *PipelineHandler {
	return &PipelineHandler{pipelineService: s, articleService: as, db: db}
}

// Reindex re-embeds and indexes all articles in Qdrant.
// Pass ?force=true to clear all embedding markers and re-embed everything.
func (h *PipelineHandler) Reindex(c *gin.Context) {
	if c.Query("force") == "true" {
		if err := h.articleService.ClearAllEmbeddingMarkers(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to clear markers: " + err.Error()})
			return
		}
	}
	if err := h.pipelineService.IndexExistingArticles(nil); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
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

	// Run pipeline
	result, err := h.pipelineService.Process(audioBytes, header.Filename, companyID, callID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// AudioClip serves an audio clip by call_id with optional start/end query params.
// GET /api/audio/:call_id?start=10.5&end=25.3
func (h *PipelineHandler) AudioClip(c *gin.Context) {
	callID := c.Param("call_id")

	// Find the transcription cache entry by filename match
	var cache models.TranscriptionCache
	search := callID + "%"
	if err := h.db.Where("file_name LIKE ?", search).First(&cache).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Audio not found for call_id"})
		return
	}

	if cache.AudioPath == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "Audio file not stored"})
		return
	}

	if _, err := os.Stat(cache.AudioPath); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Audio file missing from disk"})
		return
	}

	// Serve the full file — frontend handles start/end via Audio API
	ext := filepath.Ext(cache.AudioPath)
	contentType := "audio/mpeg"
	if ext == ".wav" {
		contentType = "audio/wav"
	} else if ext == ".ogg" {
		contentType = "audio/ogg"
	}

	c.Header("Accept-Ranges", "bytes")
	c.Header("Content-Disposition", fmt.Sprintf("inline; filename=%q", cache.FileName))
	c.File(cache.AudioPath)
	_ = contentType // c.File sets content-type automatically
}

// TranscriptSegments returns diarized segments for a call_id.
// GET /api/transcript/:call_id/segments
func (h *PipelineHandler) TranscriptSegments(c *gin.Context) {
	callID := c.Param("call_id")

	var cache models.TranscriptionCache
	search := callID + "%"
	if err := h.db.Where("file_name LIKE ?", search).First(&cache).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Transcript not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"call_id":    callID,
		"file_name":  cache.FileName,
		"transcript": cache.Transcript,
		"segments":   cache.Segments,
		"audio_available": cache.AudioPath != "",
	})
}
