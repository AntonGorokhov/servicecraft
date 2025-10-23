package services

import (
	"errors"
	"fmt"

	"github.com/vetkb/backend/internal/models"
	"gorm.io/gorm"
)

type CommentService struct {
	db *gorm.DB
}

func NewCommentService(db *gorm.DB) *CommentService {
	return &CommentService{db: db}
}

func (s *CommentService) ListByArticle(articleID uint, companyID *uint) ([]models.Comment, error) {
	var comments []models.Comment
	q := s.db.Where("article_id = ?", articleID).Preload("User")
	if companyID != nil {
		q = q.Where("company_id = ?", *companyID)
	}
	if err := q.Order("created_at asc").Find(&comments).Error; err != nil {
		return nil, err
	}
	return comments, nil
}

func (s *CommentService) Create(comment *models.Comment) error {
	if err := s.db.Create(comment).Error; err != nil {
		return fmt.Errorf("failed to create comment: %w", err)
	}
	// Preload user for response
	s.db.Preload("User").First(comment, comment.ID)
	return nil
}

func (s *CommentService) Delete(id uint, userID uint, companyID *uint, isAdmin bool) error {
	var comment models.Comment
	q := s.db.Where("id = ?", id)
	if companyID != nil {
		q = q.Where("company_id = ?", *companyID)
	}
	if err := q.First(&comment).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("comment not found")
		}
		return err
	}
	if !isAdmin && comment.UserID != userID {
		return errors.New("can only delete own comments")
	}
	if err := s.db.Delete(&comment).Error; err != nil {
		return fmt.Errorf("failed to delete comment: %w", err)
	}
	return nil
}
