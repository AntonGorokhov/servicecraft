package services

import (
	"errors"

	"github.com/vetkb/backend/internal/models"
	"gorm.io/gorm"
)

type FAQService struct {
	db *gorm.DB
}

func NewFAQService(db *gorm.DB) *FAQService {
	return &FAQService{db: db}
}

// List returns all FAQ entries for a company, ordered by priority desc.
func (s *FAQService) List(companyID *uint) ([]models.FAQ, error) {
	var faqs []models.FAQ
	q := s.db
	if companyID != nil {
		q = q.Where("company_id = ?", *companyID)
	}
	if err := q.Order("priority desc").Find(&faqs).Error; err != nil {
		return nil, err
	}
	return faqs, nil
}

// GetBySlug returns a single FAQ entry.
func (s *FAQService) GetBySlug(companyID *uint, slug string) (*models.FAQ, error) {
	var faq models.FAQ
	q := s.db
	if companyID != nil {
		q = q.Where("company_id = ?", *companyID)
	}
	if err := q.Where("slug = ?", slug).First(&faq).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &faq, nil
}

// Create creates a new FAQ entry.
func (s *FAQService) Create(faq *models.FAQ) error {
	return s.db.Create(faq).Error
}

// Update updates a FAQ entry.
func (s *FAQService) Update(companyID *uint, slug string, updates map[string]interface{}) (*models.FAQ, error) {
	faq, err := s.GetBySlug(companyID, slug)
	if err != nil {
		return nil, err
	}
	if faq == nil {
		return nil, errors.New("faq not found")
	}
	if err := s.db.Model(faq).Updates(updates).Error; err != nil {
		return nil, err
	}
	s.db.First(faq, faq.ID)
	return faq, nil
}

// Delete deletes a FAQ entry.
func (s *FAQService) Delete(companyID *uint, slug string) error {
	faq, err := s.GetBySlug(companyID, slug)
	if err != nil {
		return err
	}
	if faq == nil {
		return errors.New("faq not found")
	}
	return s.db.Delete(faq).Error
}
