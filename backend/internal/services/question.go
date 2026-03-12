package services

import (
	"encoding/json"
	"errors"
	"log"
	"time"

	"github.com/vetkb/backend/internal/models"
	"gorm.io/gorm"
)

// QuestionIndexer is implemented in main to avoid circular imports (pipeline → services).
type QuestionIndexer interface {
	IndexQuestion(questionID uint, question, answer, themeName string, frequency int, companyID *uint) error
}

type QuestionService struct {
	db      *gorm.DB
	indexer QuestionIndexer
}

func NewQuestionService(db *gorm.DB, indexer QuestionIndexer) *QuestionService {
	return &QuestionService{db: db, indexer: indexer}
}

type QuestionStats struct {
	Total          int     `json:"total"`
	Scripted       int     `json:"scripted"`
	Pending        int     `json:"pending"`
	AcceptanceRate float64 `json:"acceptance_rate"` // % of ai_status=accepted among scripted
}

func (s *QuestionService) Stats(companyID *uint) (*QuestionStats, error) {
	q := s.db.Model(&models.Question{})
	if companyID != nil {
		q = q.Where("company_id = ?", *companyID)
	}
	var total, scripted, accepted int64
	q.Count(&total)

	sq := s.db.Model(&models.Question{}).Where("answer != ''")
	if companyID != nil {
		sq = sq.Where("company_id = ?", *companyID)
	}
	sq.Count(&scripted)

	aq := s.db.Model(&models.Question{}).Where("ai_status = 'accepted'")
	if companyID != nil {
		aq = aq.Where("company_id = ?", *companyID)
	}
	aq.Count(&accepted)

	rate := 0.0
	if scripted > 0 {
		rate = float64(accepted) / float64(scripted) * 100
	}
	return &QuestionStats{
		Total:          int(total),
		Scripted:       int(scripted),
		Pending:        int(total) - int(scripted),
		AcceptanceRate: rate,
	}, nil
}

type ListQuestionsFilter struct {
	Status string
	Theme  string
	Search string
	Limit  int
}

func (s *QuestionService) List(companyID *uint, f ListQuestionsFilter) ([]models.Question, error) {
	var questions []models.Question
	q := s.db.Model(&models.Question{})
	if companyID != nil {
		q = q.Where("company_id = ?", *companyID)
	}
	switch f.Status {
	case "scripted":
		q = q.Where("answer != ''")
	case "unscripted":
		q = q.Where("answer = ''")
	}
	if f.Theme != "" {
		q = q.Where("theme_name = ?", f.Theme)
	}
	if f.Search != "" {
		q = q.Where("question ILIKE ?", "%"+f.Search+"%")
	}
	q = q.Order("frequency desc")
	if f.Limit > 0 {
		q = q.Limit(f.Limit)
	}
	if err := q.Find(&questions).Error; err != nil {
		return nil, err
	}
	return questions, nil
}

func (s *QuestionService) GetByID(companyID *uint, id uint) (*models.Question, error) {
	var q models.Question
	db := s.db
	if companyID != nil {
		db = db.Where("company_id = ?", *companyID)
	}
	if err := db.First(&q, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &q, nil
}

func (s *QuestionService) SaveAnswer(companyID *uint, id uint, answer string) (*models.Question, error) {
	q, err := s.GetByID(companyID, id)
	if err != nil || q == nil {
		return nil, errors.New("question not found")
	}
	now := time.Now()
	updates := map[string]interface{}{
		"answer":     answer,
		"updated_at": now,
	}
	if s.indexer != nil && answer != "" {
		if ierr := s.indexer.IndexQuestion(q.ID, q.Question, answer, q.ThemeName, q.Frequency, q.CompanyID); ierr != nil {
			log.Printf("[qa-index] failed to index question %d: %v", q.ID, ierr)
		} else {
			updates["rag_approved"] = true
			updates["indexed_at"] = now
		}
	}
	if err := s.db.Model(q).Updates(updates).Error; err != nil {
		return nil, err
	}
	s.db.First(q, q.ID)
	return q, nil
}

func (s *QuestionService) AcceptDraft(companyID *uint, id uint) (*models.Question, error) {
	q, err := s.GetByID(companyID, id)
	if err != nil || q == nil {
		return nil, errors.New("question not found")
	}
	if q.AIAnswer == "" {
		return nil, errors.New("no AI draft available")
	}
	now := time.Now()
	updates := map[string]interface{}{
		"answer":     q.AIAnswer,
		"ai_status":  "accepted",
		"updated_at": now,
	}
	if s.indexer != nil {
		if ierr := s.indexer.IndexQuestion(q.ID, q.Question, q.AIAnswer, q.ThemeName, q.Frequency, q.CompanyID); ierr != nil {
			log.Printf("[qa-index] failed to index question %d: %v", q.ID, ierr)
		} else {
			updates["rag_approved"] = true
			updates["indexed_at"] = now
		}
	}
	if err := s.db.Model(q).Updates(updates).Error; err != nil {
		return nil, err
	}
	s.db.First(q, q.ID)
	return q, nil
}

// ReindexAll indexes all scripted questions into Qdrant. Returns count of indexed questions.
func (s *QuestionService) ReindexAll(companyID *uint) (int, error) {
	if s.indexer == nil {
		return 0, errors.New("indexer not configured")
	}
	questions, err := s.List(companyID, ListQuestionsFilter{Status: "scripted"})
	if err != nil {
		return 0, err
	}
	count := 0
	for _, q := range questions {
		if ierr := s.indexer.IndexQuestion(q.ID, q.Question, q.Answer, q.ThemeName, q.Frequency, q.CompanyID); ierr != nil {
			log.Printf("[reindex] question %d failed: %v", q.ID, ierr)
			continue
		}
		now := time.Now()
		s.db.Model(&q).Updates(map[string]interface{}{
			"rag_approved": true,
			"indexed_at":   now,
		})
		count++
	}
	return count, nil
}

// ImportResult holds counts from an import operation.
type ImportResult struct {
	Created int `json:"created"`
	Updated int `json:"updated"`
	Skipped int `json:"skipped"`
}

// KnowledgeOSExport mirrors the structure of knowledgeos-export JSON.
type KnowledgeOSExport struct {
	Themes            []KOSTheme            `json:"themes"`
	QAPairs           []KOSQAPair           `json:"qa_pairs"`
	Calls             []KOSCall             `json:"calls"`
	QAPairCallMentions []KOSMention          `json:"qa_pair_call_mentions"`
}

type KOSTheme struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type KOSQAPair struct {
	ID       string `json:"id"`
	Question string `json:"question"`
	Answer   string `json:"answer"`
	AIAnswer string `json:"ai_answer"`
	AIStatus string `json:"ai_status"`
	ThemeID  string `json:"theme_id"`
	Frequency int   `json:"frequency"`
	IsFAQ    bool   `json:"is_faq"`
	IsLocked bool   `json:"is_locked"`
}

type KOSCall struct {
	ID         string `json:"id"`
	ExternalID string `json:"external_id"`
	Transcript string `json:"transcript"`
	OccurredAt string `json:"occurred_at"`
}

type KOSMention struct {
	QAPairID    string `json:"qa_pair_id"`
	CallID      string `json:"call_id"`
	Snippet     string `json:"snippet"`
	StartOffset int    `json:"start_offset"`
	EndOffset   int    `json:"end_offset"`
}

type EvidenceItem struct {
	CallID      string `json:"call_id"`
	Snippet     string `json:"snippet"`
	StartOffset int    `json:"start_offset"`
	EndOffset   int    `json:"end_offset"`
}

func (s *QuestionService) Import(companyID *uint, export *KnowledgeOSExport) (*ImportResult, error) {
	result := &ImportResult{}

	// Build theme map: id → name
	themeMap := make(map[string]string, len(export.Themes))
	for _, t := range export.Themes {
		themeMap[t.ID] = t.Name
	}

	// Build evidence map: qa_pair_id → []EvidenceItem
	evidenceMap := make(map[string][]EvidenceItem, len(export.QAPairCallMentions))
	for _, m := range export.QAPairCallMentions {
		evidenceMap[m.QAPairID] = append(evidenceMap[m.QAPairID], EvidenceItem{
			CallID:      m.CallID,
			Snippet:     m.Snippet,
			StartOffset: m.StartOffset,
			EndOffset:   m.EndOffset,
		})
	}

	for _, qp := range export.QAPairs {
		if qp.ID == "" || qp.Question == "" {
			result.Skipped++
			continue
		}

		evidenceJSON, _ := json.Marshal(evidenceMap[qp.ID])

		aiStatus := qp.AIStatus
		if aiStatus == "" {
			aiStatus = "pending"
		}

		q := models.Question{
			ExternalID: qp.ID,
			CompanyID:  companyID,
			Question:   qp.Question,
			Answer:     qp.Answer,
			AIAnswer:   qp.AIAnswer,
			AIStatus:   aiStatus,
			ThemeID:    qp.ThemeID,
			ThemeName:  themeMap[qp.ThemeID],
			Frequency:  qp.Frequency,
			IsFAQ:      qp.IsFAQ,
			IsLocked:   qp.IsLocked,
			Evidence:   evidenceJSON,
		}

		// Upsert by external_id
		var existing models.Question
		err := s.db.Where("external_id = ?", qp.ID).First(&existing).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if err := s.db.Create(&q).Error; err != nil {
				return nil, err
			}
			result.Created++
		} else if err == nil {
			updates := map[string]interface{}{
				"question":   q.Question,
				"answer":     q.Answer,
				"ai_answer":  q.AIAnswer,
				"ai_status":  q.AIStatus,
				"theme_id":   q.ThemeID,
				"theme_name": q.ThemeName,
				"frequency":  q.Frequency,
				"is_faq":     q.IsFAQ,
				"is_locked":  q.IsLocked,
				"evidence":   q.Evidence,
				"updated_at": time.Now(),
			}
			if err := s.db.Model(&existing).Updates(updates).Error; err != nil {
				return nil, err
			}
			result.Updated++
		} else {
			return nil, err
		}
	}

	return result, nil
}

// Export returns all questions for a company in KnowledgeOS export format.
func (s *QuestionService) Export(companyID *uint) (*KnowledgeOSExport, error) {
	questions, err := s.List(companyID, ListQuestionsFilter{})
	if err != nil {
		return nil, err
	}

	// Build unique themes
	themesSeen := make(map[string]string)
	for _, q := range questions {
		if q.ThemeID != "" {
			themesSeen[q.ThemeID] = q.ThemeName
		}
	}
	themes := make([]KOSTheme, 0, len(themesSeen))
	for id, name := range themesSeen {
		themes = append(themes, KOSTheme{ID: id, Name: name})
	}

	qaPairs := make([]KOSQAPair, 0, len(questions))
	mentions := make([]KOSMention, 0)

	for _, q := range questions {
		qaPairs = append(qaPairs, KOSQAPair{
			ID:        q.ExternalID,
			Question:  q.Question,
			Answer:    q.Answer,
			AIAnswer:  q.AIAnswer,
			AIStatus:  q.AIStatus,
			ThemeID:   q.ThemeID,
			Frequency: q.Frequency,
			IsFAQ:     q.IsFAQ,
			IsLocked:  q.IsLocked,
		})

		var evidence []EvidenceItem
		if err := json.Unmarshal(q.Evidence, &evidence); err == nil {
			for _, e := range evidence {
				mentions = append(mentions, KOSMention{
					QAPairID:    q.ExternalID,
					CallID:      e.CallID,
					Snippet:     e.Snippet,
					StartOffset: e.StartOffset,
					EndOffset:   e.EndOffset,
				})
			}
		}
	}

	return &KnowledgeOSExport{
		Themes:             themes,
		QAPairs:            qaPairs,
		Calls:              []KOSCall{},
		QAPairCallMentions: mentions,
	}, nil
}

// Themes returns distinct theme names for a company.
func (s *QuestionService) Themes(companyID *uint) ([]string, error) {
	var themes []string
	q := s.db.Model(&models.Question{}).Select("DISTINCT theme_name").Where("theme_name != ''")
	if companyID != nil {
		q = q.Where("company_id = ?", *companyID)
	}
	if err := q.Order("theme_name").Pluck("theme_name", &themes).Error; err != nil {
		return nil, err
	}
	return themes, nil
}

