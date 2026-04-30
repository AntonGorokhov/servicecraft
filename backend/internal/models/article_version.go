package models

import (
	"encoding/json"
	"time"
)

type ArticleVersion struct {
	ID        uint            `json:"id" gorm:"primaryKey"`
	ArticleID uint            `json:"article_id" gorm:"index;not null"`
	Version   int             `json:"version" gorm:"not null"`
	Content   json.RawMessage `json:"content" gorm:"type:jsonb"`
	ChangedBy *uint           `json:"changed_by"`
	ChangeLog string          `json:"change_log"`
	Source    string          `json:"source"`
	CallID    string          `json:"call_id,omitempty"`
	CreatedAt time.Time       `json:"created_at"`
}

func (ArticleVersion) TableName() string { return "article_versions" }
