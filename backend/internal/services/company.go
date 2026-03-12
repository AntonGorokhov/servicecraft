package services

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/vetkb/backend/internal/models"
	"gorm.io/gorm"
)

type CompanyService struct {
	db *gorm.DB
}

func NewCompanyService(db *gorm.DB) *CompanyService {
	return &CompanyService{db: db}
}

func (s *CompanyService) Create(name, slug string) (*models.Company, error) {
	company := models.Company{Name: name, Slug: slug}
	if err := s.db.Create(&company).Error; err != nil {
		return nil, fmt.Errorf("failed to create company: %w", err)
	}
	return &company, nil
}

func (s *CompanyService) List() ([]models.Company, error) {
	var companies []models.Company
	if err := s.db.Order("id asc").Find(&companies).Error; err != nil {
		return nil, err
	}
	return companies, nil
}

func (s *CompanyService) Delete(id uint) error {
	// Check if company has users
	var count int64
	s.db.Model(&models.User{}).Where("company_id = ?", id).Count(&count)
	if count > 0 {
		return errors.New("cannot delete company with existing users")
	}
	if err := s.db.Delete(&models.Company{}, id).Error; err != nil {
		return fmt.Errorf("failed to delete company: %w", err)
	}
	return nil
}

func (s *CompanyService) CreateUser(companyID uint, email, password, name, role string) (*models.User, error) {
	// Verify company exists
	var company models.Company
	if err := s.db.First(&company, companyID).Error; err != nil {
		return nil, errors.New("company not found")
	}

	// Only allow admin/operator roles for company users
	if role != "admin" && role != "operator" {
		return nil, errors.New("role must be admin or operator")
	}

	user := models.User{
		Email:     email,
		Name:      name,
		Role:      role,
		CompanyID: &companyID,
	}
	if err := user.SetPassword(password); err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}
	if err := s.db.Create(&user).Error; err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}
	return &user, nil
}

func (s *CompanyService) GetSettings(companyID uint) (json.RawMessage, error) {
	var company models.Company
	if err := s.db.First(&company, companyID).Error; err != nil {
		return nil, err
	}
	if len(company.Settings) == 0 {
		return json.RawMessage(`{}`), nil
	}
	return company.Settings, nil
}

func (s *CompanyService) UpdateSettings(companyID uint, settings json.RawMessage) error {
	return s.db.Model(&models.Company{}).Where("id = ?", companyID).Update("settings", settings).Error
}

func (s *CompanyService) GetUsers(companyID uint) ([]models.User, error) {
	var users []models.User
	if err := s.db.Where("company_id = ?", companyID).Order("id asc").Find(&users).Error; err != nil {
		return nil, err
	}
	return users, nil
}
