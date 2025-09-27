package services

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/vetkb/backend/internal/models"
	"gorm.io/gorm"
)

type ArticleService struct {
	db *gorm.DB
}

func NewArticleService(db *gorm.DB) *ArticleService {
	return &ArticleService{db: db}
}

// List returns articles filtered by company. companyID nil = superadmin (no filter).
func (s *ArticleService) List(companyID *uint) ([]models.Article, error) {
	var articles []models.Article
	q := s.db.Select("id, company_id, slug, name, category, call_count, steps, exceptions, last_updated, created_at, updated_at")
	if companyID != nil {
		q = q.Where("company_id = ?", *companyID)
	}
	if err := q.Order("call_count desc").Find(&articles).Error; err != nil {
		return nil, err
	}
	return articles, nil
}

// GetBySlug returns a single article with content.
func (s *ArticleService) GetBySlug(companyID *uint, slug string) (*models.Article, error) {
	var article models.Article
	q := s.db
	if companyID != nil {
		q = q.Where("company_id = ?", *companyID)
	}
	if err := q.Where("slug = ?", slug).First(&article).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &article, nil
}

// Create creates a new article.
func (s *ArticleService) Create(article *models.Article) error {
	if err := s.db.Create(article).Error; err != nil {
		return fmt.Errorf("failed to create article: %w", err)
	}
	return nil
}

// Update updates an existing article by slug, respecting company isolation.
func (s *ArticleService) Update(companyID *uint, slug string, updates map[string]interface{}) (*models.Article, error) {
	article, err := s.GetBySlug(companyID, slug)
	if err != nil {
		return nil, err
	}
	if article == nil {
		return nil, errors.New("article not found")
	}

	if err := s.db.Model(article).Updates(updates).Error; err != nil {
		return nil, fmt.Errorf("failed to update article: %w", err)
	}
	// Reload to return fresh data
	s.db.First(article, article.ID)
	return article, nil
}

// ListWithEmbeddings returns articles with their embedding vectors, filtered by company.
func (s *ArticleService) ListWithEmbeddings(companyID *uint) ([]models.Article, error) {
	var articles []models.Article
	q := s.db.Select("id, company_id, slug, name, category, content, embedding")
	if companyID != nil {
		q = q.Where("company_id = ?", *companyID)
	}
	if err := q.Find(&articles).Error; err != nil {
		return nil, err
	}
	return articles, nil
}

// UpdateEmbedding updates just the embedding field for an article.
func (s *ArticleService) UpdateEmbedding(articleID uint, embedding json.RawMessage) error {
	return s.db.Model(&models.Article{}).Where("id = ?", articleID).Update("embedding", embedding).Error
}

// Delete deletes an article by slug, respecting company isolation.
func (s *ArticleService) Delete(companyID *uint, slug string) error {
	article, err := s.GetBySlug(companyID, slug)
	if err != nil {
		return err
	}
	if article == nil {
		return errors.New("article not found")
	}
	if err := s.db.Delete(article).Error; err != nil {
		return fmt.Errorf("failed to delete article: %w", err)
	}
	return nil
}
