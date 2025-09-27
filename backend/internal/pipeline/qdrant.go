package pipeline

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

const (
	collectionName = "articles"
	vectorDim      = 1024
)

// QdrantService wraps the Qdrant REST API for article embeddings.
type QdrantService struct {
	baseURL    string
	httpClient *http.Client
}

// NewQdrantService connects to Qdrant via REST and ensures the collection exists.
func NewQdrantService(host string, port int) (*QdrantService, error) {
	svc := &QdrantService{
		baseURL:    fmt.Sprintf("http://%s:%d", host, port),
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
	if err := svc.ensureCollection(); err != nil {
		return nil, err
	}
	return svc, nil
}

func (s *QdrantService) ensureCollection() error {
	// Check if collection exists
	resp, err := s.httpClient.Get(s.baseURL + "/collections/" + collectionName)
	if err != nil {
		return fmt.Errorf("qdrant check collection: %w", err)
	}
	resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		log.Printf("[qdrant] Collection '%s' already exists", collectionName)
		return nil
	}

	// Create collection
	body := map[string]interface{}{
		"vectors": map[string]interface{}{
			"size":     vectorDim,
			"distance": "Cosine",
		},
	}
	payload, _ := json.Marshal(body)

	req, _ := http.NewRequest("PUT", s.baseURL+"/collections/"+collectionName, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")

	resp, err = s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("qdrant create collection: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("qdrant create collection %d: %s", resp.StatusCode, string(respBody))
	}

	log.Printf("[qdrant] Created collection '%s' (dim=%d, cosine)", collectionName, vectorDim)
	return nil
}

// UpsertArticle stores or updates an article's embedding in Qdrant.
func (s *QdrantService) UpsertArticle(articleID uint, slug, name, category string, companyID *uint, vector []float32) error {
	var cidVal uint
	if companyID != nil {
		cidVal = *companyID
	}

	body := map[string]interface{}{
		"points": []map[string]interface{}{
			{
				"id":     articleID,
				"vector": vector,
				"payload": map[string]interface{}{
					"slug":       slug,
					"name":       name,
					"category":   category,
					"company_id": cidVal,
				},
			},
		},
	}
	payload, _ := json.Marshal(body)

	req, _ := http.NewRequest("PUT", s.baseURL+"/collections/"+collectionName+"/points", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("qdrant upsert: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("qdrant upsert %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// SearchResult holds a single Qdrant search match.
type SearchResult struct {
	ArticleID uint
	Slug      string
	Name      string
	Category  string
	Score     float64
}

// SearchSimilar finds the most similar articles to the given vector.
func (s *QdrantService) SearchSimilar(vector []float32, companyID *uint, limit int, scoreThreshold float32) ([]SearchResult, error) {
	body := map[string]interface{}{
		"query":           vector,
		"limit":           limit,
		"score_threshold": scoreThreshold,
		"with_payload":    true,
	}

	// Superadmin (nil companyID) sees all articles — no filter.
	// Company user sees own articles + global (company_id=0).
	if companyID != nil {
		body["filter"] = map[string]interface{}{
			"should": []map[string]interface{}{
				{"key": "company_id", "match": map[string]interface{}{"value": *companyID}},
				{"key": "company_id", "match": map[string]interface{}{"value": 0}},
			},
		}
	}
	payload, _ := json.Marshal(body)

	resp, err := s.httpClient.Post(s.baseURL+"/collections/"+collectionName+"/points/query", "application/json", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("qdrant search: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("qdrant search %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Result struct {
			Points []struct {
				ID      interface{}            `json:"id"`
				Score   float64                `json:"score"`
				Payload map[string]interface{} `json:"payload"`
			} `json:"points"`
		} `json:"result"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("parse search result: %w", err)
	}

	var results []SearchResult
	for _, p := range result.Result.Points {
		r := SearchResult{Score: p.Score}
		// Parse ID (can be float64 from JSON)
		switch id := p.ID.(type) {
		case float64:
			r.ArticleID = uint(id)
		case json.Number:
			v, _ := id.Int64()
			r.ArticleID = uint(v)
		}
		if v, ok := p.Payload["slug"].(string); ok {
			r.Slug = v
		}
		if v, ok := p.Payload["name"].(string); ok {
			r.Name = v
		}
		if v, ok := p.Payload["category"].(string); ok {
			r.Category = v
		}
		results = append(results, r)
	}
	return results, nil
}

// Close is a no-op for REST client (kept for interface compatibility).
func (s *QdrantService) Close() error {
	return nil
}
