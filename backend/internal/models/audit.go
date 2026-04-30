package models

import (
	"encoding/json"
	"time"
)

type AuditLog struct {
	ID        uint            `json:"id" gorm:"primaryKey"`
	UserID    *uint           `json:"user_id" gorm:"index"`
	CompanyID *uint           `json:"company_id" gorm:"index"`
	Action    string          `json:"action" gorm:"not null;index"`
	Resource  string          `json:"resource" gorm:"not null"`
	ResourceID string         `json:"resource_id"`
	Details   json.RawMessage `json:"details" gorm:"type:jsonb"`
	IPAddress string          `json:"ip_address"`
	UserAgent string          `json:"user_agent"`
	CreatedAt time.Time       `json:"created_at" gorm:"index"`
}

func (AuditLog) TableName() string { return "audit_logs" }
