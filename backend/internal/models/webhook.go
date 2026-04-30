package models

import (
	"time"

	"gorm.io/gorm"
)

type Webhook struct {
	ID        uint           `json:"id" gorm:"primaryKey"`
	CompanyID *uint          `json:"company_id" gorm:"index"`
	URL       string         `json:"url" gorm:"not null"`
	Secret    string         `json:"-" gorm:"not null"`
	Events    string         `json:"events" gorm:"not null"`
	Active    bool           `json:"active" gorm:"default:true"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}

type WebhookDelivery struct {
	ID         uint      `json:"id" gorm:"primaryKey"`
	WebhookID  uint      `json:"webhook_id" gorm:"index;not null"`
	Event      string    `json:"event" gorm:"not null"`
	Payload    string    `json:"payload" gorm:"type:text"`
	StatusCode int       `json:"status_code"`
	Response   string    `json:"response" gorm:"type:text"`
	Duration   int       `json:"duration_ms"`
	Success    bool      `json:"success"`
	CreatedAt  time.Time `json:"created_at"`
}

func (Webhook) TableName() string        { return "webhooks" }
func (WebhookDelivery) TableName() string { return "webhook_deliveries" }
