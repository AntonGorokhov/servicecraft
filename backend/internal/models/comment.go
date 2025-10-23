package models

import "time"

type Comment struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	ArticleID uint      `json:"article_id" gorm:"index;not null"`
	Article   *Article  `json:"-" gorm:"foreignKey:ArticleID"`
	UserID    uint      `json:"user_id" gorm:"index;not null"`
	User      *User     `json:"user,omitempty" gorm:"foreignKey:UserID"`
	CompanyID  *uint     `json:"company_id" gorm:"index"`
	QuotedText string    `json:"quoted_text" gorm:"type:text"`
	Body       string    `json:"body" gorm:"type:text;not null"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
