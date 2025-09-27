package pipeline

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const replicateBaseURL = "https://api.replicate.com/v1"

type ReplicateClient struct {
	token      string
	httpClient *http.Client
}

func NewReplicateClient(token string) *ReplicateClient {
	return &ReplicateClient{
		token: token,
		httpClient: &http.Client{
			Timeout: 300 * time.Second,
		},
	}
}

type prediction struct {
	ID     string      `json:"id"`
	Status string      `json:"status"`
	Output interface{} `json:"output"`
	Error  interface{} `json:"error"`
}

// RunModel creates a prediction using the /models/{model}/predictions endpoint.
// Uses Prefer: wait for sync response, falls back to polling.
func (c *ReplicateClient) RunModel(model string, input map[string]interface{}) (interface{}, error) {
	body := map[string]interface{}{
		"input": input,
	}
	url := fmt.Sprintf("%s/models/%s/predictions", replicateBaseURL, model)
	return c.runPrediction(url, body)
}

// RunVersion creates a prediction using the /predictions endpoint with an explicit version hash.
// Required for community models that need a version specifier.
func (c *ReplicateClient) RunVersion(version string, input map[string]interface{}) (interface{}, error) {
	body := map[string]interface{}{
		"version": version,
		"input":   input,
	}
	url := fmt.Sprintf("%s/predictions", replicateBaseURL)
	return c.runPrediction(url, body)
}

func (c *ReplicateClient) runPrediction(url string, body map[string]interface{}) (interface{}, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal input: %w", err)
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "wait")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("replicate request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("replicate API error %d: %s", resp.StatusCode, string(respBody))
	}

	var pred prediction
	if err := json.Unmarshal(respBody, &pred); err != nil {
		return nil, fmt.Errorf("unmarshal prediction: %w", err)
	}

	if pred.Status == "succeeded" {
		return pred.Output, nil
	}
	if pred.Status == "failed" || pred.Status == "canceled" {
		return nil, fmt.Errorf("prediction %s: %v", pred.Status, pred.Error)
	}

	return c.poll(pred.ID)
}

func (c *ReplicateClient) poll(predictionID string) (interface{}, error) {
	url := fmt.Sprintf("%s/predictions/%s", replicateBaseURL, predictionID)

	for i := 0; i < 120; i++ {
		time.Sleep(5 * time.Second)

		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			return nil, fmt.Errorf("create poll request: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+c.token)

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("poll request: %w", err)
		}

		respBody, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("read poll response: %w", err)
		}

		var pred prediction
		if err := json.Unmarshal(respBody, &pred); err != nil {
			return nil, fmt.Errorf("unmarshal poll response: %w", err)
		}

		switch pred.Status {
		case "succeeded":
			return pred.Output, nil
		case "failed", "canceled":
			return nil, fmt.Errorf("prediction %s: %v", pred.Status, pred.Error)
		}
	}

	return nil, fmt.Errorf("prediction %s timed out after 10 minutes", predictionID)
}
