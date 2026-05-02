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

type LocalEmbeddingService struct {
	baseURL    string
	model      string
	dimensions int
	client     *http.Client
}

func NewLocalEmbeddingService(baseURL, model string, dimensions int) *LocalEmbeddingService {
	return &LocalEmbeddingService{
		baseURL:    baseURL,
		model:      model,
		dimensions: dimensions,
		client:     &http.Client{Timeout: 30 * time.Second},
	}
}

func (s *LocalEmbeddingService) Embed(text string) ([]float32, error) {
	payload, _ := json.Marshal(map[string]interface{}{
		"model": s.model,
		"input": text,
	})

	resp, err := s.client.Post(s.baseURL+"/v1/embeddings", "application/json", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("local embedding request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("local embedding %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Data []struct {
			Embedding []float32 `json:"embedding"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decode embedding: %w", err)
	}
	if len(result.Data) == 0 {
		return nil, fmt.Errorf("no embeddings in response")
	}
	return result.Data[0].Embedding, nil
}

func (s *LocalEmbeddingService) EmbedBatch(texts []string) ([][]float32, error) {
	payload, _ := json.Marshal(map[string]interface{}{
		"model": s.model,
		"input": texts,
	})

	resp, err := s.client.Post(s.baseURL+"/v1/embeddings", "application/json", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("batch embedding request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("batch embedding %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Data []struct {
			Embedding []float32 `json:"embedding"`
			Index     int       `json:"index"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decode batch embedding: %w", err)
	}

	embeddings := make([][]float32, len(texts))
	for _, d := range result.Data {
		if d.Index < len(embeddings) {
			embeddings[d.Index] = d.Embedding
		}
	}
	return embeddings, nil
}

func (s *LocalEmbeddingService) HealthCheck() error {
	resp, err := s.client.Get(s.baseURL + "/health")
	if err != nil {
		return fmt.Errorf("embedding service unreachable: %w", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("embedding service unhealthy: %d", resp.StatusCode)
	}
	log.Printf("[local-embed] service healthy at %s, model=%s, dim=%d", s.baseURL, s.model, s.dimensions)
	return nil
}
