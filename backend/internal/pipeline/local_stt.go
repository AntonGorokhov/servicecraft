package pipeline

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"time"
)

type LocalSTTService struct {
	baseURL  string
	model    string
	language string
	client   *http.Client
}

func NewLocalSTTService(baseURL, model, language string) *LocalSTTService {
	return &LocalSTTService{
		baseURL:  baseURL,
		model:    model,
		language: language,
		client:   &http.Client{Timeout: 300 * time.Second},
	}
}

type TranscriptionResult struct {
	Text     string    `json:"text"`
	Language string    `json:"language"`
	Duration float64   `json:"duration"`
	Segments []STTSegment `json:"segments,omitempty"`
}

type STTSegment struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Text  string  `json:"text"`
}

func (s *LocalSTTService) Transcribe(audioData []byte, filename string) (*TranscriptionResult, error) {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return nil, fmt.Errorf("create form file: %w", err)
	}
	if _, err := part.Write(audioData); err != nil {
		return nil, fmt.Errorf("write audio data: %w", err)
	}

	writer.WriteField("model", s.model)
	writer.WriteField("language", s.language)
	writer.WriteField("response_format", "verbose_json")
	writer.WriteField("timestamp_granularities[]", "segment")
	writer.Close()

	req, err := http.NewRequest("POST", s.baseURL+"/v1/audio/transcriptions", &buf)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("stt request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("stt error %d: %s", resp.StatusCode, string(body))
	}

	var result TranscriptionResult
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decode transcription: %w", err)
	}
	return &result, nil
}

func (s *LocalSTTService) HealthCheck() error {
	resp, err := s.client.Get(s.baseURL + "/health")
	if err != nil {
		return fmt.Errorf("stt service unreachable: %w", err)
	}
	resp.Body.Close()
	return nil
}
