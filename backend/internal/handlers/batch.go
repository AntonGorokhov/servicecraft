package handlers

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/vetkb/backend/internal/pipeline"
)

type BatchHandler struct {
	pipeline *pipeline.PipelineService
}

func NewBatchHandler(ps *pipeline.PipelineService) *BatchHandler {
	return &BatchHandler{pipeline: ps}
}

type batchFileResult struct {
	FileName string                 `json:"file_name"`
	Status   string                 `json:"status"`
	Result   *pipeline.ProcessResult `json:"result,omitempty"`
	Error    string                 `json:"error,omitempty"`
}

func (h *BatchHandler) ProcessBatch(c *gin.Context) {
	companyID := extractCompanyID(c)

	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "multipart form required"})
		return
	}

	files := form.File["files"]
	if len(files) == 0 || len(files) > 20 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "1-20 files required"})
		return
	}

	results := make([]batchFileResult, len(files))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 3)

	for i, fh := range files {
		wg.Add(1)
		go func(idx int, fileName string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			f, err := files[idx].Open()
			if err != nil {
				results[idx] = batchFileResult{FileName: fileName, Status: "error", Error: "failed to open"}
				return
			}
			defer f.Close()

			audioBytes, err := io.ReadAll(io.LimitReader(f, 100*1024*1024))
			if err != nil {
				results[idx] = batchFileResult{FileName: fileName, Status: "error", Error: "failed to read"}
				return
			}

			callID := fmt.Sprintf("batch-%s-%d", fileName, idx)
			log.Printf("[batch] Processing %d/%d: %s", idx+1, len(files), fileName)

			result, err := h.pipeline.Process(audioBytes, fileName, companyID, callID)
			if err != nil {
				results[idx] = batchFileResult{FileName: fileName, Status: "error", Error: err.Error()}
				return
			}
			results[idx] = batchFileResult{FileName: fileName, Status: "success", Result: result}
		}(i, fh.Filename)
	}
	wg.Wait()

	succeeded, failed := 0, 0
	for _, r := range results {
		if r.Status == "success" {
			succeeded++
		} else {
			failed++
		}
	}
	c.JSON(http.StatusOK, gin.H{"total": len(files), "succeeded": succeeded, "failed": failed, "results": results})
}
