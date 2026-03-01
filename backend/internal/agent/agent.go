package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/vetkb/backend/internal/pipeline"
	"github.com/vetkb/backend/internal/services"
)

const (
	ragTopK         = 5
	ragThreshold    = 0.5
	ragContextLimit = 3
	historyLimit    = 20
)

type Source struct {
	Slug     string  `json:"slug"`
	Name     string  `json:"name"`
	Category string  `json:"category"`
	Score    float64 `json:"score"`
}

type AgentService struct {
	qdrant      *pipeline.QdrantService
	articles    *services.ArticleService
	prices      *services.PriceService
	pipeline    *pipeline.PipelineService
	yandex      *YandexGPTClient
	chatService *services.ChatService
	faqService  *services.FAQService
}

func NewAgentService(
	qdrant *pipeline.QdrantService,
	articles *services.ArticleService,
	prices *services.PriceService,
	pipelineSvc *pipeline.PipelineService,
	yandex *YandexGPTClient,
	chatService *services.ChatService,
	faqService *services.FAQService,
) *AgentService {
	return &AgentService{
		qdrant:      qdrant,
		articles:    articles,
		prices:      prices,
		pipeline:    pipelineSvc,
		yandex:      yandex,
		chatService: chatService,
		faqService:  faqService,
	}
}

// ContextResult holds RAG context without LLM response — for voice agent function calls.
type ContextResult struct {
	Context   string   `json:"context"`
	Sources   []Source `json:"sources"`
	PriceInfo string   `json:"price_info,omitempty"`
}

// QueryContextBySlugs fetches articles by slug, formats them, and does price matching.
// Used by the LiveKit voice agent (no embedding, no Qdrant — agent handles those locally).
func (a *AgentService) QueryContextBySlugs(slugs []string, query string, companyID *uint) *ContextResult {
	result := &ContextResult{}

	var contextParts []string
	for _, slug := range slugs {
		article, err := a.articles.GetBySlug(companyID, slug)
		if err != nil || article == nil {
			continue
		}
		contextParts = append(contextParts, formatArticleContext(article.Name, article.Content))
		result.Sources = append(result.Sources, Source{
			Slug:     article.Slug,
			Name:     article.Name,
			Category: article.Category,
		})
	}
	result.Context = strings.Join(contextParts, "\n\n---\n\n")

	if query != "" {
		if priceMatch := a.prices.MatchService(query); priceMatch != nil {
			result.PriceInfo = fmt.Sprintf("%s — %d руб. (категория: %s)", priceMatch.Name, priceMatch.Price, priceMatch.Category)
		}
	}

	return result
}

// ArticleForIndex is a minimal article representation for the reindex endpoint.
type ArticleForIndex struct {
	ID        uint            `json:"id"`
	Slug      string          `json:"slug"`
	Name      string          `json:"name"`
	Category  string          `json:"category"`
	CompanyID *uint           `json:"company_id"`
	Content   json.RawMessage `json:"content"`
}

// ListAllArticles returns all articles for re-indexing by the voice agent.
func (a *AgentService) ListAllArticles() ([]ArticleForIndex, error) {
	articles, err := a.articles.ListAll()
	if err != nil {
		return nil, err
	}

	var result []ArticleForIndex
	for _, ar := range articles {
		result = append(result, ArticleForIndex{
			ID:        ar.ID,
			Slug:      ar.Slug,
			Name:      ar.Name,
			Category:  ar.Category,
			CompanyID: ar.CompanyID,
			Content:   ar.Content,
		})
	}
	return result, nil
}

// QuerySync performs RAG search + non-streaming LLM completion.
func (a *AgentService) QuerySync(
	ctx context.Context,
	userMsg string,
	sessionID uint,
	companyID *uint,
) (string, []Source, error) {
	var fullResponse strings.Builder
	sources, err := a.Query(ctx, userMsg, sessionID, companyID, func(text string) {
		fullResponse.WriteString(text)
	})
	if err != nil {
		return "", sources, err
	}
	return fullResponse.String(), sources, nil
}

// Query performs RAG search + LLM streaming. Returns sources found.
func (a *AgentService) Query(
	ctx context.Context,
	userMsg string,
	sessionID uint,
	companyID *uint,
	onChunk func(text string),
) ([]Source, error) {
	// 1. Embed user message
	vec, err := a.pipeline.GetEmbedding(userMsg)
	if err != nil {
		log.Printf("[agent] embedding failed: %v", err)
		// Continue without RAG context
		return a.streamWithoutRAG(ctx, userMsg, sessionID, onChunk)
	}

	// 2. Qdrant search
	matches, err := a.qdrant.SearchSimilar(vec, companyID, ragTopK, ragThreshold)
	if err != nil {
		log.Printf("[agent] qdrant search failed: %v", err)
		return a.streamWithoutRAG(ctx, userMsg, sessionID, onChunk)
	}

	// 3. Build sources list
	var sources []Source
	for _, m := range matches {
		sources = append(sources, Source{
			Slug:     m.Slug,
			Name:     m.Name,
			Category: m.Category,
			Score:    m.Score,
		})
	}

	// 4. Fetch FAQ context (highest priority)
	var contextParts []string
	if faqContext := a.buildFAQContext(companyID); faqContext != "" {
		contextParts = append(contextParts, faqContext)
	}

	// 5. Fetch full article content for top matches
	limit := ragContextLimit
	if len(matches) < limit {
		limit = len(matches)
	}
	for _, m := range matches[:limit] {
		article, err := a.articles.GetBySlug(companyID, m.Slug)
		if err != nil || article == nil {
			continue
		}
		contextParts = append(contextParts, formatArticleContext(article.Name, article.Content))
	}

	// 6. Price match
	var priceContext string
	if priceMatch := a.prices.MatchService(userMsg); priceMatch != nil {
		priceContext = fmt.Sprintf("\nЦена из прайс-листа: %s — %d руб. (категория: %s)", priceMatch.Name, priceMatch.Price, priceMatch.Category)
	}

	// 7. Build system prompt
	systemPrompt := buildSystemPrompt(strings.Join(contextParts, "\n\n---\n\n"), priceContext)

	// 8. Load conversation history
	var messages []Message
	messages = append(messages, Message{Role: "system", Text: systemPrompt})

	history, _ := a.chatService.GetMessages(sessionID)
	// Limit history
	if len(history) > historyLimit {
		history = history[len(history)-historyLimit:]
	}
	for _, h := range history {
		messages = append(messages, Message{Role: h.Role, Text: h.Content})
	}

	// Add current user message
	messages = append(messages, Message{Role: "user", Text: userMsg})

	// 9. Stream response
	var fullResponse strings.Builder
	err = a.yandex.StreamCompletion(ctx, messages, func(text string) {
		fullResponse.WriteString(text)
		onChunk(text)
	})
	if err != nil {
		return sources, fmt.Errorf("yandex gpt stream: %w", err)
	}

	// 10. Save messages to DB
	sourcesJSON, _ := json.Marshal(sources)
	a.chatService.AddMessage(sessionID, "user", userMsg, nil)
	a.chatService.AddMessage(sessionID, "assistant", fullResponse.String(), sourcesJSON)

	return sources, nil
}

func (a *AgentService) streamWithoutRAG(ctx context.Context, userMsg string, sessionID uint, onChunk func(text string)) ([]Source, error) {
	faqContext := a.buildFAQContext(nil) // no company filter in fallback
	systemPrompt := buildSystemPrompt(faqContext, "")

	var messages []Message
	messages = append(messages, Message{Role: "system", Text: systemPrompt})

	history, _ := a.chatService.GetMessages(sessionID)
	if len(history) > historyLimit {
		history = history[len(history)-historyLimit:]
	}
	for _, h := range history {
		messages = append(messages, Message{Role: h.Role, Text: h.Content})
	}
	messages = append(messages, Message{Role: "user", Text: userMsg})

	var fullResponse strings.Builder
	err := a.yandex.StreamCompletion(ctx, messages, func(text string) {
		fullResponse.WriteString(text)
		onChunk(text)
	})
	if err != nil {
		return nil, fmt.Errorf("yandex gpt stream: %w", err)
	}

	a.chatService.AddMessage(sessionID, "user", userMsg, nil)
	a.chatService.AddMessage(sessionID, "assistant", fullResponse.String(), nil)

	return nil, nil
}

// buildFAQContext loads all FAQ entries and formats them as priority context.
func (a *AgentService) buildFAQContext(companyID *uint) string {
	if a.faqService == nil {
		return ""
	}
	faqs, err := a.faqService.List(companyID)
	if err != nil || len(faqs) == 0 {
		return ""
	}

	var parts []string
	parts = append(parts, "═══ СПРАВОЧНАЯ ИНФОРМАЦИЯ О КЛИНИКЕ (ПРИОРИТЕТ) ═══")
	for _, faq := range faqs {
		parts = append(parts, formatFAQEntry(faq.Title, faq.Content))
	}
	return strings.Join(parts, "\n\n")
}

// formatFAQEntry formats a single FAQ entry for the system prompt.
func formatFAQEntry(title string, content json.RawMessage) string {
	var obj map[string]interface{}
	if err := json.Unmarshal(content, &obj); err != nil {
		return fmt.Sprintf("## %s\n(содержимое недоступно)", title)
	}

	var parts []string
	parts = append(parts, fmt.Sprintf("## %s", title))

	// Generic key-value rendering
	for key, val := range obj {
		switch v := val.(type) {
		case string:
			parts = append(parts, fmt.Sprintf("%s: %s", key, v))
		case []interface{}:
			var items []string
			for _, item := range v {
				switch it := item.(type) {
				case string:
					items = append(items, "- "+it)
				case map[string]interface{}:
					// Q&A format
					if q, ok := it["q"].(string); ok {
						a, _ := it["a"].(string)
						items = append(items, fmt.Sprintf("В: %s\nО: %s", q, a))
					} else if name, ok := it["name"].(string); ok {
						// Branch or doctor format
						line := name
						if addr, ok := it["address"].(string); ok {
							line += ", " + addr
						}
						if hours, ok := it["hours"].(string); ok {
							line += " (" + hours + ")"
						}
						if spec, ok := it["specialty"].(string); ok {
							line += " — " + spec
						}
						items = append(items, "- "+line)
					}
				}
			}
			if len(items) > 0 {
				parts = append(parts, strings.Join(items, "\n"))
			}
		}
	}

	return strings.Join(parts, "\n")
}

func formatArticleContext(name string, content json.RawMessage) string {
	var obj map[string]interface{}
	if err := json.Unmarshal(content, &obj); err != nil {
		return fmt.Sprintf("Статья: %s\n(содержимое недоступно)", name)
	}

	var parts []string
	parts = append(parts, fmt.Sprintf("Статья: %s", name))

	if phrases, ok := obj["trigger_phrases"].([]interface{}); ok {
		var pp []string
		for _, p := range phrases {
			if s, ok := p.(string); ok {
				pp = append(pp, s)
			}
		}
		if len(pp) > 0 {
			parts = append(parts, "Триггерные фразы: "+strings.Join(pp, "; "))
		}
	}

	if flow, ok := obj["conversation_flow"].([]interface{}); ok {
		var steps []string
		for _, f := range flow {
			switch v := f.(type) {
			case map[string]interface{}:
				if s, ok := v["step"].(string); ok {
					steps = append(steps, s)
				}
			case string:
				steps = append(steps, v)
			}
		}
		if len(steps) > 0 {
			parts = append(parts, "Алгоритм:\n- "+strings.Join(steps, "\n- "))
		}
	}

	if faq, ok := obj["faq"].([]interface{}); ok {
		var qas []string
		for _, f := range faq {
			if m, ok := f.(map[string]interface{}); ok {
				q, _ := m["q"].(string)
				a, _ := m["a"].(string)
				if q != "" && a != "" {
					qas = append(qas, fmt.Sprintf("В: %s\nО: %s", q, a))
				}
			}
		}
		if len(qas) > 0 {
			parts = append(parts, "FAQ:\n"+strings.Join(qas, "\n"))
		}
	}

	if svcPrices, ok := obj["services_and_prices"].([]interface{}); ok {
		var sp []string
		for _, s := range svcPrices {
			if m, ok := s.(map[string]interface{}); ok {
				svc, _ := m["service"].(string)
				price, _ := m["price"].(float64)
				if svc != "" {
					if price > 0 {
						sp = append(sp, fmt.Sprintf("- %s: %d руб.", svc, int(price)))
					} else {
						sp = append(sp, fmt.Sprintf("- %s: цена уточняется", svc))
					}
				}
			}
		}
		if len(sp) > 0 {
			parts = append(parts, "Услуги и цены:\n"+strings.Join(sp, "\n"))
		}
	}

	if redFlags, ok := obj["red_flags"].([]interface{}); ok {
		var rf []string
		for _, r := range redFlags {
			if s, ok := r.(string); ok {
				rf = append(rf, s)
			}
		}
		if len(rf) > 0 {
			parts = append(parts, "Красные флаги: "+strings.Join(rf, "; "))
		}
	}

	return strings.Join(parts, "\n")
}

func buildSystemPrompt(kbContext, priceContext string) string {
	prompt := `Ты — оператор колл-центра ветеринарной клиники. Твоя задача — помогать клиентам, отвечая на вопросы о ветеринарных услугах, ценах и записи на приём.

Правила:
1. Отвечай ТОЛЬКО на основе предоставленного контекста из базы знаний. Если информации нет — честно скажи, что не знаешь, и предложи уточнить у администратора клиники.
2. Будь вежливым, кратким и профессиональным.
3. Если клиент описывает симптомы, требующие срочной помощи — настоятельно рекомендуй немедленно обратиться в клинику.
4. Называй цены из прайс-листа, если они есть в контексте. Уточняй, что окончательная стоимость определяется после осмотра.
5. Отвечай на русском языке.
6. Используй Markdown для форматирования ответов.`

	if kbContext != "" {
		prompt += "\n\n--- КОНТЕКСТ ИЗ БАЗЫ ЗНАНИЙ ---\n\n" + kbContext
	}

	if priceContext != "" {
		prompt += "\n\n--- ПРАЙС-ЛИСТ ---" + priceContext
	}

	return prompt
}
