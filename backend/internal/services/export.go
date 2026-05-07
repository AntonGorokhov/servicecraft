package services

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/vetkb/backend/internal/models"
	"gorm.io/gorm"
)

type ExportService struct {
	db             *gorm.DB
	articleService *ArticleService
}

func NewExportService(db *gorm.DB, articleService *ArticleService) *ExportService {
	return &ExportService{db: db, articleService: articleService}
}

type ExportArticle struct {
	Slug        string          `json:"slug"`
	Name        string          `json:"name"`
	Category    string          `json:"category"`
	CallCount   int             `json:"call_count"`
	LastUpdated string          `json:"last_updated"`
	Content     json.RawMessage `json:"content"`
}

func (s *ExportService) ExportJSON(companyID *uint) ([]byte, error) {
	articles, err := s.articleService.ListAll()
	if err != nil {
		return nil, err
	}

	var exported []ExportArticle
	for _, a := range articles {
		if companyID != nil && (a.CompanyID == nil || *a.CompanyID != *companyID) {
			continue
		}
		exported = append(exported, ExportArticle{
			Slug: a.Slug, Name: a.Name, Category: a.Category,
			CallCount: a.CallCount, LastUpdated: a.LastUpdated, Content: a.Content,
		})
	}

	return json.MarshalIndent(exported, "", "  ")
}

func (s *ExportService) ExportCSV(companyID *uint, w io.Writer) error {
	articles, err := s.articleService.ListAll()
	if err != nil {
		return err
	}

	writer := csv.NewWriter(w)
	defer writer.Flush()

	writer.Write([]string{"slug", "name", "category", "call_count", "last_updated", "trigger_phrases", "faq_count"})

	for _, a := range articles {
		if companyID != nil && (a.CompanyID == nil || *a.CompanyID != *companyID) {
			continue
		}

		triggerPhrases := ""
		faqCount := 0

		var content map[string]interface{}
		if json.Unmarshal(a.Content, &content) == nil {
			if phrases, ok := content["trigger_phrases"].([]interface{}); ok {
				var pp []string
				for _, p := range phrases {
					if str, ok := p.(string); ok {
						pp = append(pp, str)
					}
				}
				triggerPhrases = strings.Join(pp, "; ")
			}
			if faq, ok := content["faq"].([]interface{}); ok {
				faqCount = len(faq)
			}
		}

		writer.Write([]string{a.Slug, a.Name, a.Category, fmt.Sprintf("%d", a.CallCount), a.LastUpdated, triggerPhrases, fmt.Sprintf("%d", faqCount)})
	}
	return nil
}

type ImportResult struct {
	Total   int      `json:"total"`
	Created int      `json:"created"`
	Updated int      `json:"updated"`
	Skipped int      `json:"skipped"`
	Errors  []string `json:"errors,omitempty"`
}

func (s *ExportService) ImportJSON(data []byte, companyID *uint, overwrite bool) (*ImportResult, error) {
	var articles []ExportArticle
	if err := json.Unmarshal(data, &articles); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}

	result := &ImportResult{Total: len(articles)}

	for _, ea := range articles {
		existing, _ := s.articleService.GetBySlug(companyID, ea.Slug)
		if existing != nil {
			if !overwrite {
				result.Skipped++
				continue
			}
			updates := map[string]interface{}{"name": ea.Name, "category": ea.Category, "content": ea.Content}
			if _, err := s.articleService.Update(companyID, ea.Slug, updates); err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", ea.Slug, err))
				continue
			}
			result.Updated++
		} else {
			article := &models.Article{CompanyID: companyID, Slug: ea.Slug, Name: ea.Name, Category: ea.Category, CallCount: ea.CallCount, LastUpdated: ea.LastUpdated, Content: ea.Content}
			if err := s.articleService.Create(article); err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", ea.Slug, err))
				continue
			}
			result.Created++
		}
	}
	return result, nil
}
