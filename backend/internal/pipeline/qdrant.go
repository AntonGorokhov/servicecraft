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
	collectionName   = "articles"
	qaCollectionName = "qa_pairs"
	vectorDim        = 1024
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

// DeleteBySlug removes all points with the given slug from Qdrant.
func (s *QdrantService) DeleteBySlug(slug string) error {
	body := map[string]interface{}{
		"filter": map[string]interface{}{
			"must": []map[string]interface{}{
				{"key": "slug", "match": map[string]interface{}{"value": slug}},
			},
		},
	}
	payload, _ := json.Marshal(body)

	req, _ := http.NewRequest("POST", s.baseURL+"/collections/"+collectionName+"/points/delete", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("qdrant delete: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("qdrant delete %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// EnsureQACollection creates the qa_pairs collection with named dense + sparse vectors.
func (s *QdrantService) EnsureQACollection() error {
	resp, err := s.httpClient.Get(s.baseURL + "/collections/" + qaCollectionName)
	if err != nil {
		return fmt.Errorf("qdrant check qa collection: %w", err)
	}
	resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		log.Printf("[qdrant] Collection '%s' already exists", qaCollectionName)
		return nil
	}

	body := map[string]interface{}{
		"vectors": map[string]interface{}{
			"dense": map[string]interface{}{
				"size":     vectorDim,
				"distance": "Cosine",
			},
		},
		"sparse_vectors": map[string]interface{}{
			"sparse": map[string]interface{}{
				"index": map[string]interface{}{
					"type": "inverted_index",
				},
			},
		},
	}
	payload, _ := json.Marshal(body)
	req, _ := http.NewRequest("PUT", s.baseURL+"/collections/"+qaCollectionName, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")

	resp, err = s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("qdrant create qa collection: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("qdrant create qa collection %d: %s", resp.StatusCode, string(respBody))
	}
	log.Printf("[qdrant] Created collection '%s' (dim=%d, cosine+sparse)", qaCollectionName, vectorDim)
	return nil
}

// UpsertQA stores or updates a Q&A pair in the qa_pairs collection.
func (s *QdrantService) UpsertQA(questionID uint, question, answer, themeName string, frequency int, companyID *uint, denseVec []float32, sparseVec SparseVector) error {
	var cidVal uint
	if companyID != nil {
		cidVal = *companyID
	}

	body := map[string]interface{}{
		"points": []map[string]interface{}{
			{
				"id": questionID,
				"vector": map[string]interface{}{
					"dense":  denseVec,
					"sparse": sparseVec,
				},
				"payload": map[string]interface{}{
					"question_id": questionID,
					"question":    question,
					"answer":      answer,
					"theme_name":  themeName,
					"frequency":   frequency,
					"company_id":  cidVal,
				},
			},
		},
	}
	payload, _ := json.Marshal(body)

	req, _ := http.NewRequest("PUT", s.baseURL+"/collections/"+qaCollectionName+"/points", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("qdrant upsert qa: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("qdrant upsert qa %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// QASearchResult holds a single hybrid QA search match.
type QASearchResult struct {
	QuestionID uint
	Question   string
	Answer     string
	ThemeName  string
	Frequency  int
	Score      float64
}

// SearchQAHybrid performs dense+sparse hybrid search over qa_pairs with RRF fusion.
func (s *QdrantService) SearchQAHybrid(denseVec []float32, sparseVec SparseVector, companyID *uint, limit int) ([]QASearchResult, error) {
	prefetch := []map[string]interface{}{
		{
			"query": denseVec,
			"using": "dense",
			"limit": limit * 4,
		},
	}
	if len(sparseVec.Indices) > 0 {
		prefetch = append(prefetch, map[string]interface{}{
			"query": sparseVec,
			"using": "sparse",
			"limit": limit * 4,
		})
	}

	body := map[string]interface{}{
		"prefetch":     prefetch,
		"query":        map[string]interface{}{"fusion": "rrf"},
		"limit":        limit,
		"with_payload": true,
	}

	if companyID != nil {
		body["filter"] = map[string]interface{}{
			"should": []map[string]interface{}{
				{"key": "company_id", "match": map[string]interface{}{"value": *companyID}},
				{"key": "company_id", "match": map[string]interface{}{"value": 0}},
			},
		}
	}

	payload, _ := json.Marshal(body)
	resp, err := s.httpClient.Post(s.baseURL+"/collections/"+qaCollectionName+"/points/query", "application/json", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("qdrant qa hybrid search: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("qdrant qa hybrid search %d: %s", resp.StatusCode, string(respBody))
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
		return nil, fmt.Errorf("parse qa search result: %w", err)
	}

	var results []QASearchResult
	for _, p := range result.Result.Points {
		r := QASearchResult{Score: p.Score}
		switch id := p.ID.(type) {
		case float64:
			r.QuestionID = uint(id)
		case json.Number:
			v, _ := id.Int64()
			r.QuestionID = uint(v)
		}
		if v, ok := p.Payload["question"].(string); ok {
			r.Question = v
		}
		if v, ok := p.Payload["answer"].(string); ok {
			r.Answer = v
		}
		if v, ok := p.Payload["theme_name"].(string); ok {
			r.ThemeName = v
		}
		if v, ok := p.Payload["frequency"].(float64); ok {
			r.Frequency = int(v)
		}
		results = append(results, r)
	}
	return results, nil
}

// Close is a no-op for REST client (kept for interface compatibility).
func (s *QdrantService) Close() error {
	return nil
}
