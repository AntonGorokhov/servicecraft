package services

import (
	"strings"

	"github.com/vetkb/backend/internal/models"
	"gorm.io/gorm"
)

type SearchService struct {
	db *gorm.DB
}

func NewSearchService(db *gorm.DB) *SearchService {
	return &SearchService{db: db}
}

type SearchResult struct {
	Article   models.Article `json:"article"`
	Score     float64        `json:"score"`
	Snippet   string         `json:"snippet"`
	MatchedIn string         `json:"matched_in"`
}

func (s *SearchService) Search(companyID *uint, query string, category string, limit int) ([]SearchResult, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	queryLower := strings.ToLower(query)
	words := strings.Fields(queryLower)

	q := s.db.Where("deleted_at IS NULL")
	if companyID != nil {
		q = q.Where("company_id = ?", *companyID)
	}
	if category != "" {
		q = q.Where("category = ?", category)
	}

	var articles []models.Article
	if err := q.Find(&articles).Error; err != nil {
		return nil, err
	}

	var results []SearchResult
	for _, a := range articles {
		score := 0.0
		matchedIn := ""
		snippet := ""

		nameLower := strings.ToLower(a.Name)
		for _, w := range words {
			if strings.Contains(nameLower, w) {
				score += 10.0
				matchedIn = "name"
			}
		}

		contentStr := strings.ToLower(string(a.Content))
		for _, w := range words {
			if idx := strings.Index(contentStr, w); idx >= 0 {
				score += 3.0
				if matchedIn == "" {
					matchedIn = "content"
				}
				start := idx - 50
				if start < 0 {
					start = 0
				}
				end := idx + len(w) + 50
				if end > len(contentStr) {
					end = len(contentStr)
				}
				snippet = "..." + string(a.Content[start:end]) + "..."
			}
		}

		score += float64(a.CallCount) * 0.1

		if score > 0 {
			results = append(results, SearchResult{Article: a, Score: score, Snippet: snippet, MatchedIn: matchedIn})
		}
	}

	for i := 0; i < len(results); i++ {
		for j := i + 1; j < len(results); j++ {
			if results[j].Score > results[i].Score {
				results[i], results[j] = results[j], results[i]
			}
		}
	}

	if len(results) > limit {
		results = results[:limit]
	}

	return results, nil
}

type ArticleLink struct {
	FromSlug string  `json:"from_slug"`
	FromName string  `json:"from_name"`
	ToSlug   string  `json:"to_slug"`
	ToName   string  `json:"to_name"`
	Strength float64 `json:"strength"`
}

func (s *SearchService) BuildKnowledgeGraph(companyID *uint) ([]ArticleLink, error) {
	q := s.db.Where("deleted_at IS NULL")
	if companyID != nil {
		q = q.Where("company_id = ?", *companyID)
	}

	var articles []models.Article
	if err := q.Find(&articles).Error; err != nil {
		return nil, err
	}

	var links []ArticleLink
	for i := 0; i < len(articles); i++ {
		for j := i + 1; j < len(articles); j++ {
			a1, a2 := articles[i], articles[j]
			if a1.Category == a2.Category && a1.Category != "" {
				words1 := extractWords(string(a1.Content))
				words2 := extractWords(string(a2.Content))
				overlap := 0
				for w := range words1 {
					if words2[w] {
						overlap++
					}
				}
				if overlap > 3 {
					links = append(links, ArticleLink{
						FromSlug: a1.Slug, FromName: a1.Name,
						ToSlug: a2.Slug, ToName: a2.Name,
						Strength: 0.5 + float64(overlap)*0.1,
					})
				}
			}
		}
	}
	return links, nil
}

func extractWords(content string) map[string]bool {
	words := strings.Fields(strings.ToLower(content))
	m := make(map[string]bool)
	for _, w := range words {
		w = strings.Trim(w, `",:;.!?()[]{}`)
		if len([]rune(w)) > 4 {
			m[w] = true
		}
	}
	return m
}
