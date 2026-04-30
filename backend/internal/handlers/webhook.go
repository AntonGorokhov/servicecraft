package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/vetkb/backend/internal/models"
	"github.com/vetkb/backend/internal/services"
)

type WebhookHandler struct {
	webhookService *services.WebhookService
}

func NewWebhookHandler(ws *services.WebhookService) *WebhookHandler {
	return &WebhookHandler{webhookService: ws}
}

func (h *WebhookHandler) Create(c *gin.Context) {
	var req struct {
		URL    string `json:"url" binding:"required"`
		Events string `json:"events" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	secret := generateWebhookSecret()
	companyID := extractCompanyID(c)

	webhook := &models.Webhook{CompanyID: companyID, URL: req.URL, Secret: secret, Events: req.Events, Active: true}
	if err := h.webhookService.Create(webhook); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"webhook": webhook, "secret": secret})
}

func (h *WebhookHandler) List(c *gin.Context) {
	companyID := extractCompanyID(c)
	webhooks, err := h.webhookService.List(companyID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, webhooks)
}

func (h *WebhookHandler) Update(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	var updates map[string]interface{}
	if err := c.ShouldBindJSON(&updates); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	delete(updates, "id")
	delete(updates, "secret")
	delete(updates, "company_id")

	if err := h.webhookService.Update(uint(id), updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "updated"})
}

func (h *WebhookHandler) Delete(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	if err := h.webhookService.Delete(uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (h *WebhookHandler) Deliveries(c *gin.Context) {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 32)
	limit := 50
	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	deliveries, err := h.webhookService.ListDeliveries(uint(id), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, deliveries)
}

func generateWebhookSecret() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}
