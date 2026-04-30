package services

import (
	"encoding/json"
	"fmt"

	"github.com/vetkb/backend/internal/models"
	"gorm.io/gorm"
)

type ArticleVersionService struct {
	db *gorm.DB
}

func NewArticleVersionService(db *gorm.DB) *ArticleVersionService {
	return &ArticleVersionService{db: db}
}

func (s *ArticleVersionService) SaveVersion(articleID uint, content json.RawMessage, changedBy *uint, source, callID, changeLog string) error {
	var maxVersion int
	s.db.Model(&models.ArticleVersion{}).
		Where("article_id = ?", articleID).
		Select("COALESCE(MAX(version), 0)").
		Scan(&maxVersion)

	version := &models.ArticleVersion{
		ArticleID: articleID,
		Version:   maxVersion + 1,
		Content:   content,
		ChangedBy: changedBy,
		ChangeLog: changeLog,
		Source:    source,
		CallID:    callID,
	}

	return s.db.Create(version).Error
}

func (s *ArticleVersionService) ListVersions(articleID uint) ([]models.ArticleVersion, error) {
	var versions []models.ArticleVersion
	err := s.db.Where("article_id = ?", articleID).
		Order("version DESC").
		Find(&versions).Error
	return versions, err
}

func (s *ArticleVersionService) GetVersion(articleID uint, version int) (*models.ArticleVersion, error) {
	var v models.ArticleVersion
	err := s.db.Where("article_id = ? AND version = ?", articleID, version).First(&v).Error
	if err != nil {
		return nil, err
	}
	return &v, nil
}

type ContentDiff struct {
	Key     string      `json:"key"`
	Type    string      `json:"type"`
	OldVal  interface{} `json:"old_value,omitempty"`
	NewVal  interface{} `json:"new_value,omitempty"`
}

func (s *ArticleVersionService) DiffVersions(articleID uint, v1, v2 int) ([]ContentDiff, error) {
	ver1, err := s.GetVersion(articleID, v1)
	if err != nil {
		return nil, fmt.Errorf("version %d: %w", v1, err)
	}
	ver2, err := s.GetVersion(articleID, v2)
	if err != nil {
		return nil, fmt.Errorf("version %d: %w", v2, err)
	}

	var old, new_ map[string]interface{}
	json.Unmarshal(ver1.Content, &old)
	json.Unmarshal(ver2.Content, &new_)

	var diffs []ContentDiff

	for key, oldVal := range old {
		newVal, exists := new_[key]
		if !exists {
			diffs = append(diffs, ContentDiff{Key: key, Type: "removed", OldVal: oldVal})
		} else {
			oldJSON, _ := json.Marshal(oldVal)
			newJSON, _ := json.Marshal(newVal)
			if string(oldJSON) != string(newJSON) {
				diffs = append(diffs, ContentDiff{Key: key, Type: "changed", OldVal: oldVal, NewVal: newVal})
			}
		}
	}

	for key, newVal := range new_ {
		if _, exists := old[key]; !exists {
			diffs = append(diffs, ContentDiff{Key: key, Type: "added", NewVal: newVal})
		}
	}

	return diffs, nil
}

func (s *ArticleVersionService) RestoreVersion(articleID uint, version int) (*models.ArticleVersion, error) {
	v, err := s.GetVersion(articleID, version)
	if err != nil {
		return nil, err
	}
	return v, nil
}
