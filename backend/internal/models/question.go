package models

import (
	"encoding/json"
	"time"
)

// Question represents a deduplicated customer question from call recordings.
// 798 unique questions are ranked by frequency and presented for operator scripting.
type Question struct {
	ID         uint            `json:"id" gorm:"primaryKey"`
	CompanyID  *uint           `json:"company_id" gorm:"index"`
	ExternalID string          `json:"external_id" gorm:"uniqueIndex;not null"` // UUID from source system
	Question   string          `json:"question" gorm:"type:text;not null"`
	Answer     string          `json:"answer" gorm:"type:text;default:''"`
	AIAnswer   string          `json:"ai_answer" gorm:"type:text;default:''"`
	AIStatus   string          `json:"ai_status" gorm:"default:'pending'"` // pending | accepted | edited
	ThemeID    string          `json:"theme_id" gorm:"default:''"`
	ThemeName  string          `json:"theme_name" gorm:"default:''"`
	Frequency  int             `json:"frequency" gorm:"default:0"`
	IsFAQ      bool            `json:"is_faq" gorm:"default:false"`
	IsLocked   bool            `json:"is_locked" gorm:"default:false"`
	Evidence    json.RawMessage `json:"evidence" gorm:"type:jsonb;default:'[]'"` // []{ call_id, snippet, start_offset, end_offset }
	RagApproved bool            `json:"rag_approved" gorm:"default:false"`
	IndexedAt   *time.Time      `json:"indexed_at"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

// Status returns the scripting status of the question.
func (q *Question) Status() string {
	if q.Answer != "" {
		return "scripted"
	}
	return "unscripted"
}
