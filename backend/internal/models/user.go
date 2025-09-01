package models

import (
	"log"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type User struct {
	ID           uint      `json:"id" gorm:"primaryKey"`
	Email        string    `json:"email" gorm:"uniqueIndex;not null"`
	PasswordHash string    `json:"-" gorm:"not null"`
	Name         string    `json:"name"`
	Role         string    `json:"role" gorm:"default:operator"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (u *User) SetPassword(password string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	u.PasswordHash = string(hash)
	return nil
}

func (u *User) CheckPassword(password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) == nil
}

func SeedAdmin(db *gorm.DB, email, password string) {
	var count int64
	db.Model(&User{}).Where("role = ?", "admin").Count(&count)
	if count > 0 {
		return
	}

	admin := User{
		Email: email,
		Name:  "Admin",
		Role:  "admin",
	}
	if err := admin.SetPassword(password); err != nil {
		log.Fatalf("Failed to hash admin password: %v", err)
	}
	if err := db.Create(&admin).Error; err != nil {
		log.Fatalf("Failed to seed admin user: %v", err)
	}
	log.Printf("Admin user created: %s", email)
}
