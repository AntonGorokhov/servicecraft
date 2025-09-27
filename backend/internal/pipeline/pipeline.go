package pipeline

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/vetkb/backend/internal/models"
	"github.com/vetkb/backend/internal/services"
)

const (
	similarityThreshold = 0.55
	embeddingVersion    = "lucataco/qwen3-embedding-8b:42d968487820032a1535d81ea20df16f442ea308ec5abae6b5d6cf4675eb3e2f"
)

// Segment represents a topic segment extracted from the transcript.
type Segment struct {
	Topic         string `json:"topic"`
	Text          string `json:"text"`
	Urgency       string `json:"urgency"`
	Category      string `json:"category"`
	SuggestedSlug string `json:"suggested_slug"`
	SuggestedName string `json:"suggested_name"`
}

// SegmentResult is the per-segment result returned in the API response.
type SegmentResult struct {
	Topic       string  `json:"topic"`
	Urgency     string  `json:"urgency"`
	Action      string  `json:"action"`
	ArticleSlug string  `json:"article_slug"`
	ArticleName string  `json:"article_name"`
	Similarity  float64 `json:"similarity,omitempty"`
}

// ProcessResult is the full pipeline response.
type ProcessResult struct {
	Transcript string          `json:"transcript"`
	Segments   []SegmentResult `json:"segments"`
	Duration   string          `json:"duration"`
}

// PipelineService orchestrates the call processing pipeline.
type PipelineService struct {
	replicate      *ReplicateClient
	qdrant         *QdrantService
	articleService *services.ArticleService
}

func NewPipelineService(replicateToken string, qdrant *QdrantService, articleService *services.ArticleService) *PipelineService {
	return &PipelineService{
		replicate:      NewReplicateClient(replicateToken),
		qdrant:         qdrant,
		articleService: articleService,
	}
}

// Process runs the full pipeline: transcribe → segment → classify (Qdrant) → enrich/create.
func (p *PipelineService) Process(audioBase64 string, companyID *uint) (*ProcessResult, error) {
	start := time.Now()

	// Stage 1: Transcription
	log.Println("[pipeline] Stage 1: Transcribing audio...")
	transcript, err := p.transcribe(audioBase64)
	if err != nil {
		return nil, fmt.Errorf("transcription failed: %w", err)
	}
	if strings.TrimSpace(transcript) == "" {
		return nil, fmt.Errorf("transcription returned empty text")
	}
	log.Printf("[pipeline] Transcript: %d chars", len(transcript))

	// Stage 2: Segmentation
	log.Println("[pipeline] Stage 2: Segmenting transcript...")
	segments, err := p.segment(transcript)
	if err != nil {
		return nil, fmt.Errorf("segmentation failed: %w", err)
	}
	log.Printf("[pipeline] Found %d segments", len(segments))

	// Ensure existing articles are indexed in Qdrant
	if err := p.indexExistingArticles(companyID); err != nil {
		log.Printf("[pipeline] Warning: article indexing error: %v", err)
	}

	// Stage 3 & 4: Classify and enrich/create for each segment
	var results []SegmentResult
	for i, seg := range segments {
		log.Printf("[pipeline] Processing segment %d/%d: %s", i+1, len(segments), seg.Topic)

		result := p.processSegment(seg, companyID)
		results = append(results, result)
	}

	duration := time.Since(start)
	return &ProcessResult{
		Transcript: transcript,
		Segments:   results,
		Duration:   fmt.Sprintf("%.1fs", duration.Seconds()),
	}, nil
}

// transcribe calls gpt-4o-transcribe on Replicate.
func (p *PipelineService) transcribe(audioBase64 string) (string, error) {
	dataURI := "data:audio/mp3;base64," + audioBase64

	output, err := p.replicate.RunModel("openai/gpt-4o-transcribe", map[string]interface{}{
		"audio_file": dataURI,
		"language":   "ru",
	})
	if err != nil {
		return "", err
	}
	return extractLLMText(output), nil
}

// segment calls gpt-oss-20b to split the transcript into coarse topic segments.
func (p *PipelineService) segment(transcript string) ([]Segment, error) {
	prompt := fmt.Sprintf(segmentationPrompt, transcript)

	output, err := p.replicate.RunModel("openai/gpt-oss-20b", map[string]interface{}{
		"prompt":     prompt,
		"max_tokens": 16384,
	})
	if err != nil {
		return nil, err
	}

	text := extractLLMText(output)
	text = stripCodeFences(text)

	var segments []Segment
	if err := json.Unmarshal([]byte(text), &segments); err != nil {
		return nil, fmt.Errorf("parse segments JSON: %w (raw: %.300s)", err, text)
	}
	return segments, nil
}

// getEmbedding calls qwen3-embedding-8b on Replicate to get a 1024-dim vector.
func (p *PipelineService) getEmbedding(text string) ([]float32, error) {
	// qwen3 expects a JSON array of strings
	textJSON := fmt.Sprintf(`[%q]`, text)

	output, err := p.replicate.RunVersion(embeddingVersion, map[string]interface{}{
		"text":          textJSON,
		"normalize":     true,
		"embedding_dim": 1024,
	})
	if err != nil {
		return nil, err
	}

	// Output is {"embedding_dim": 1024, "embeddings": [[float, ...]]}
	outMap, ok := output.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("unexpected embedding output type: %T", output)
	}

	embeddings, ok := outMap["embeddings"].([]interface{})
	if !ok || len(embeddings) == 0 {
		return nil, fmt.Errorf("no embeddings in output")
	}

	firstEmb, ok := embeddings[0].([]interface{})
	if !ok {
		return nil, fmt.Errorf("unexpected embedding format")
	}

	vec := make([]float32, len(firstEmb))
	for i, v := range firstEmb {
		f, ok := v.(float64)
		if !ok {
			return nil, fmt.Errorf("embedding element %d not a number", i)
		}
		vec[i] = float32(f)
	}
	return vec, nil
}

// indexExistingArticles ensures all articles are indexed in Qdrant.
func (p *PipelineService) indexExistingArticles(companyID *uint) error {
	articles, err := p.articleService.ListWithEmbeddings(companyID)
	if err != nil {
		return err
	}

	// Check which articles are already in Qdrant by trying a search
	// Simple approach: re-index all articles (Qdrant upsert is idempotent)
	indexed := 0
	for _, a := range articles {
		// Skip if already has an embedding stored (use Embedding field as cache marker)
		if len(a.Embedding) > 4 { // non-null, non-empty JSON
			continue
		}

		embText := buildArticleEmbeddingText(a)
		vec, err := p.getEmbedding(embText)
		if err != nil {
			log.Printf("[pipeline] Warning: failed to embed article %s: %v", a.Slug, err)
			continue
		}

		if err := p.qdrant.UpsertArticle(a.ID, a.Slug, a.Name, a.Category, a.CompanyID, vec); err != nil {
			log.Printf("[pipeline] Warning: failed to index article %s in Qdrant: %v", a.Slug, err)
			continue
		}

		// Mark as indexed in PostgreSQL
		marker, _ := json.Marshal(map[string]bool{"indexed": true})
		p.articleService.UpdateEmbedding(a.ID, marker)
		indexed++
	}

	if indexed > 0 {
		log.Printf("[pipeline] Indexed %d articles in Qdrant", indexed)
	}
	return nil
}

// buildArticleEmbeddingText creates the text to embed for an article.
func buildArticleEmbeddingText(a models.Article) string {
	parts := []string{a.Name}

	var content map[string]interface{}
	if err := json.Unmarshal(a.Content, &content); err == nil {
		if phrases, ok := content["trigger_phrases"].([]interface{}); ok {
			for _, p := range phrases {
				if s, ok := p.(string); ok {
					parts = append(parts, s)
				}
			}
		}
	}

	return strings.Join(parts, ". ")
}

// processSegment handles classification and enrichment/creation for a single segment.
func (p *PipelineService) processSegment(seg Segment, companyID *uint) SegmentResult {
	result := SegmentResult{
		Topic:   seg.Topic,
		Urgency: seg.Urgency,
	}

	// Stage 3: Embed segment and search Qdrant
	segVec, err := p.getEmbedding(seg.Topic + ". " + seg.Text)
	if err != nil {
		log.Printf("[pipeline] Warning: failed to embed segment '%s': %v", seg.Topic, err)
		return p.createNewArticle(seg, companyID, segVec, result)
	}

	matches, err := p.qdrant.SearchSimilar(segVec, companyID, 3, similarityThreshold)
	if err != nil {
		log.Printf("[pipeline] Warning: Qdrant search failed: %v", err)
		return p.createNewArticle(seg, companyID, segVec, result)
	}

	if len(matches) > 0 {
		best := matches[0]
		log.Printf("[pipeline] Matched '%s' → '%s' (score=%.3f)", seg.Topic, best.Slug, best.Score)

		// Stage 4a: Enrich existing article
		result.Action = "enriched"
		result.ArticleSlug = best.Slug
		result.ArticleName = best.Name
		result.Similarity = best.Score

		if err := p.enrichArticle(best.Slug, seg, companyID); err != nil {
			log.Printf("[pipeline] Warning: enrichment failed for %s: %v", best.Slug, err)
			result.Action = "enrichment_failed"
		}
		return result
	}

	// Stage 4b: No match — but check slug collision first
	existing, _ := p.articleService.GetBySlug(companyID, seg.SuggestedSlug)
	if existing != nil {
		log.Printf("[pipeline] Slug '%s' exists, enriching instead of creating", seg.SuggestedSlug)
		result.Action = "enriched"
		result.ArticleSlug = existing.Slug
		result.ArticleName = existing.Name

		if err := p.enrichArticle(existing.Slug, seg, companyID); err != nil {
			log.Printf("[pipeline] Warning: enrichment failed for %s: %v", existing.Slug, err)
			result.Action = "enrichment_failed"
		}
		return result
	}

	return p.createNewArticle(seg, companyID, segVec, result)
}

// enrichArticle updates an existing article with information from a segment.
func (p *PipelineService) enrichArticle(slug string, seg Segment, companyID *uint) error {
	article, err := p.articleService.GetBySlug(companyID, slug)
	if err != nil || article == nil {
		return fmt.Errorf("get article %s: %w", slug, err)
	}

	prompt := fmt.Sprintf(enrichArticlePrompt, article.Name, string(article.Content), seg.Text)
	output, err := p.replicate.RunModel("openai/gpt-oss-20b", map[string]interface{}{
		"prompt":     prompt,
		"max_tokens": 16384,
	})
	if err != nil {
		return fmt.Errorf("enrich LLM call: %w", err)
	}

	text := extractLLMText(output)
	text = stripCodeFences(text)

	var contentCheck json.RawMessage
	if err := json.Unmarshal([]byte(text), &contentCheck); err != nil {
		return fmt.Errorf("invalid enriched content JSON: %w", err)
	}

	updates := map[string]interface{}{
		"content":    contentCheck,
		"call_count": article.CallCount + 1,
	}
	if _, err := p.articleService.Update(companyID, slug, updates); err != nil {
		return fmt.Errorf("update article: %w", err)
	}

	return nil
}

// createNewArticle creates a new article and indexes it in Qdrant.
func (p *PipelineService) createNewArticle(seg Segment, companyID *uint, segVec []float32, result SegmentResult) SegmentResult {
	result.Action = "created"
	result.ArticleSlug = seg.SuggestedSlug
	result.ArticleName = seg.SuggestedName

	prompt := fmt.Sprintf(createArticlePrompt, seg.Topic, seg.Category, seg.Text)
	output, err := p.replicate.RunModel("openai/gpt-oss-20b", map[string]interface{}{
		"prompt":     prompt,
		"max_tokens": 16384,
	})
	if err != nil {
		log.Printf("[pipeline] Warning: create article LLM failed for '%s': %v", seg.Topic, err)
		result.Action = "creation_failed"
		return result
	}

	text := extractLLMText(output)
	text = stripCodeFences(text)

	var content json.RawMessage
	if err := json.Unmarshal([]byte(text), &content); err != nil {
		log.Printf("[pipeline] Warning: invalid created content JSON for '%s': %v", seg.Topic, err)
		content = json.RawMessage(`{"trigger_phrases":[],"conversation_flow":[],"clarifying_questions":[],"exceptions":[],"services_and_prices":[],"red_flags":[],"never_say":[],"faq":[],"evidence":[]}`)
	}

	now := time.Now().Format("2 Jan")
	article := &models.Article{
		CompanyID:   companyID,
		Slug:        seg.SuggestedSlug,
		Name:        seg.SuggestedName,
		Category:    seg.Category,
		CallCount:   1,
		LastUpdated: now,
		Content:     content,
	}

	if err := p.articleService.Create(article); err != nil {
		log.Printf("[pipeline] Warning: failed to create article '%s': %v", seg.SuggestedSlug, err)
		result.Action = "creation_failed"
		return result
	}

	// Index in Qdrant
	if len(segVec) > 0 {
		if err := p.qdrant.UpsertArticle(article.ID, article.Slug, article.Name, article.Category, companyID, segVec); err != nil {
			log.Printf("[pipeline] Warning: failed to index new article in Qdrant: %v", err)
		}
		marker, _ := json.Marshal(map[string]bool{"indexed": true})
		p.articleService.UpdateEmbedding(article.ID, marker)
	}

	return result
}

// extractLLMText extracts text from LLM output (handles string arrays from gpt-oss-20b).
func extractLLMText(output interface{}) string {
	switch v := output.(type) {
	case string:
		return v
	case []interface{}:
		var parts []string
		for _, item := range v {
			if s, ok := item.(string); ok {
				parts = append(parts, s)
			}
		}
		return strings.Join(parts, "")
	default:
		raw, _ := json.Marshal(output)
		return string(raw)
	}
}

// stripCodeFences removes markdown code fences from LLM output.
func stripCodeFences(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		lines := strings.SplitN(s, "\n", 2)
		if len(lines) == 2 {
			s = lines[1]
		}
		if idx := strings.LastIndex(s, "```"); idx >= 0 {
			s = s[:idx]
		}
	}
	return strings.TrimSpace(s)
}
