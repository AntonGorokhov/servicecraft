package models

import "time"

type Company struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	Name      string    `json:"name" gorm:"not null"`
	Slug      string    `json:"slug" gorm:"uniqueIndex;not null"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	Users     []User    `json:"users,omitempty" gorm:"foreignKey:CompanyID"`
}
