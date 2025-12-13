package models

import (
	"encoding/json"
	"time"
)

type ChatSession struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	UserID    uint      `json:"user_id" gorm:"index"`
	CompanyID *uint     `json:"company_id" gorm:"index"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ChatMessage struct {
	ID        uint            `json:"id" gorm:"primaryKey"`
	SessionID uint            `json:"session_id" gorm:"index"`
	Role      string          `json:"role"`
	Content   string          `json:"content"`
	Sources   json.RawMessage `json:"sources,omitempty" gorm:"type:jsonb"`
	CreatedAt time.Time       `json:"created_at"`
}
