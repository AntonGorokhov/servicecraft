package services

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/vetkb/backend/internal/models"
	"gorm.io/gorm"
)

type WebhookService struct {
	db     *gorm.DB
	client *http.Client
}

func NewWebhookService(db *gorm.DB) *WebhookService {
	return &WebhookService{
		db:     db,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

type WebhookPayload struct {
	Event     string      `json:"event"`
	Timestamp string      `json:"timestamp"`
	Data      interface{} `json:"data"`
}

func (s *WebhookService) Create(webhook *models.Webhook) error {
	return s.db.Create(webhook).Error
}

func (s *WebhookService) List(companyID *uint) ([]models.Webhook, error) {
	var webhooks []models.Webhook
	q := s.db.Order("created_at DESC")
	if companyID != nil {
		q = q.Where("company_id = ?", *companyID)
	}
	err := q.Find(&webhooks).Error
	return webhooks, err
}

func (s *WebhookService) Update(id uint, updates map[string]interface{}) error {
	return s.db.Model(&models.Webhook{}).Where("id = ?", id).Updates(updates).Error
}

func (s *WebhookService) Delete(id uint) error {
	return s.db.Delete(&models.Webhook{}, id).Error
}

func (s *WebhookService) ListDeliveries(webhookID uint, limit int) ([]models.WebhookDelivery, error) {
	var deliveries []models.WebhookDelivery
	err := s.db.Where("webhook_id = ?", webhookID).
		Order("created_at DESC").Limit(limit).Find(&deliveries).Error
	return deliveries, err
}

func (s *WebhookService) Dispatch(event string, companyID *uint, data interface{}) {
	var webhooks []models.Webhook
	q := s.db.Where("active = ?", true)
	if companyID != nil {
		q = q.Where("company_id = ?", *companyID)
	}
	q.Find(&webhooks)

	for _, wh := range webhooks {
		if !matchesEvent(wh.Events, event) {
			continue
		}
		go s.deliver(wh, event, data)
	}
}

func matchesEvent(events, event string) bool {
	for _, e := range strings.Split(events, ",") {
		if strings.TrimSpace(e) == event {
			return true
		}
	}
	return false
}

func (s *WebhookService) deliver(wh models.Webhook, event string, data interface{}) {
	payload := WebhookPayload{
		Event:     event,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Data:      data,
	}

	body, _ := json.Marshal(payload)
	mac := hmac.New(sha256.New, []byte(wh.Secret))
	mac.Write(body)
	signature := fmt.Sprintf("sha256=%s", hex.EncodeToString(mac.Sum(nil)))

	req, _ := http.NewRequest("POST", wh.URL, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-Event", event)
	req.Header.Set("X-Webhook-Signature", signature)

	start := time.Now()
	resp, err := s.client.Do(req)
	duration := time.Since(start).Milliseconds()

	delivery := models.WebhookDelivery{
		WebhookID: wh.ID,
		Event:     event,
		Payload:   string(body),
		Duration:  int(duration),
	}

	if err != nil {
		delivery.Success = false
		delivery.Response = err.Error()
	} else {
		defer resp.Body.Close()
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		delivery.StatusCode = resp.StatusCode
		delivery.Response = string(respBody)
		delivery.Success = resp.StatusCode >= 200 && resp.StatusCode < 300
	}

	if err := s.db.Create(&delivery).Error; err != nil {
		log.Printf("[webhook] failed to save delivery: %v", err)
	}
}
