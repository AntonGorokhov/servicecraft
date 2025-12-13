package agent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const yandexGPTURL = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"

type Message struct {
	Role string `json:"role"`
	Text string `json:"text"`
}

type YandexGPTClient struct {
	apiKey   string
	folderID string
	model    string
	client   *http.Client
}

func NewYandexGPTClient(apiKey, folderID, model string) *YandexGPTClient {
	return &YandexGPTClient{
		apiKey:   apiKey,
		folderID: folderID,
		model:    model,
		client:   &http.Client{Timeout: 120 * time.Second},
	}
}

func (c *YandexGPTClient) modelURI() string {
	return fmt.Sprintf("gpt://%s/%s", c.folderID, c.model)
}

// StreamCompletion sends a streaming completion request to YandexGPT.
// Each NDJSON line contains the full text so far; we compute deltas and call onChunk.
func (c *YandexGPTClient) StreamCompletion(ctx context.Context, messages []Message, onChunk func(text string)) error {
	body := map[string]interface{}{
		"modelUri": c.modelURI(),
		"completionOptions": map[string]interface{}{
			"stream":      true,
			"temperature":  0.3,
			"maxTokens":   "2000",
		},
		"messages": messages,
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", yandexGPTURL, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Api-Key "+c.apiKey)
	req.Header.Set("x-folder-id", c.folderID)

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("yandex gpt request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("yandex gpt %d: %s", resp.StatusCode, string(respBody))
	}

	// Parse NDJSON stream. Each line has full text accumulated so far.
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	prevText := ""

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var chunk struct {
			Result struct {
				Alternatives []struct {
					Message struct {
						Text string `json:"text"`
					} `json:"message"`
					Status string `json:"status"`
				} `json:"alternatives"`
			} `json:"result"`
		}

		if err := json.Unmarshal(line, &chunk); err != nil {
			continue
		}

		if len(chunk.Result.Alternatives) == 0 {
			continue
		}

		fullText := chunk.Result.Alternatives[0].Message.Text
		if len(fullText) > len(prevText) {
			delta := fullText[len(prevText):]
			onChunk(delta)
			prevText = fullText
		}
	}

	return scanner.Err()
}
