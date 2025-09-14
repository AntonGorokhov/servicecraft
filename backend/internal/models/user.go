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
	CompanyID    *uint     `json:"company_id" gorm:"index"`
	Company      *Company  `json:"company,omitempty" gorm:"foreignKey:CompanyID"`
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
	var user User
	// Try to find existing user by email to upgrade
	if err := db.Where("email = ?", email).First(&user).Error; err == nil {
		// User exists — upgrade to superadmin if needed
		if user.Role != "superadmin" {
			db.Model(&user).Update("role", "superadmin")
			db.Model(&user).Update("company_id", nil)
			log.Printf("Upgraded user %s to superadmin", email)
		}
		return
	}

	// No user with this email — create superadmin
	admin := User{
		Email: email,
		Name:  "Admin",
		Role:  "superadmin",
	}
	if err := admin.SetPassword(password); err != nil {
		log.Fatalf("Failed to hash admin password: %v", err)
	}
	if err := db.Create(&admin).Error; err != nil {
		log.Fatalf("Failed to seed admin user: %v", err)
	}
	log.Printf("Superadmin user created: %s", email)
}
