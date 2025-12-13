package services

import (
	"encoding/json"

	"github.com/vetkb/backend/internal/models"
	"gorm.io/gorm"
)

type ChatService struct {
	db *gorm.DB
}

func NewChatService(db *gorm.DB) *ChatService {
	return &ChatService{db: db}
}

func (s *ChatService) CreateSession(userID uint, companyID *uint, title string) (*models.ChatSession, error) {
	session := &models.ChatSession{
		UserID:    userID,
		CompanyID: companyID,
		Title:     title,
	}
	if err := s.db.Create(session).Error; err != nil {
		return nil, err
	}
	return session, nil
}

func (s *ChatService) ListSessions(userID uint) ([]models.ChatSession, error) {
	var sessions []models.ChatSession
	err := s.db.Where("user_id = ?", userID).Order("updated_at DESC").Find(&sessions).Error
	return sessions, err
}

func (s *ChatService) GetSession(sessionID, userID uint) (*models.ChatSession, error) {
	var session models.ChatSession
	err := s.db.Where("id = ? AND user_id = ?", sessionID, userID).First(&session).Error
	if err != nil {
		return nil, err
	}
	return &session, nil
}

func (s *ChatService) DeleteSession(sessionID, userID uint) error {
	// Delete messages first
	s.db.Where("session_id = ?", sessionID).Delete(&models.ChatMessage{})
	return s.db.Where("id = ? AND user_id = ?", sessionID, userID).Delete(&models.ChatSession{}).Error
}

func (s *ChatService) AddMessage(sessionID uint, role, content string, sources json.RawMessage) (*models.ChatMessage, error) {
	msg := &models.ChatMessage{
		SessionID: sessionID,
		Role:      role,
		Content:   content,
		Sources:   sources,
	}
	if err := s.db.Create(msg).Error; err != nil {
		return nil, err
	}
	// Touch session updated_at
	s.db.Model(&models.ChatSession{}).Where("id = ?", sessionID).Update("updated_at", msg.CreatedAt)
	return msg, nil
}

func (s *ChatService) GetMessages(sessionID uint) ([]models.ChatMessage, error) {
	var messages []models.ChatMessage
	err := s.db.Where("session_id = ?", sessionID).Order("created_at ASC").Find(&messages).Error
	return messages, err
}
