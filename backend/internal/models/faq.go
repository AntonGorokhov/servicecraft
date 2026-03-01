package models

import (
	"encoding/json"
	"log"
	"time"

	"gorm.io/gorm"
)

// FAQ stores clinic-level info entries (addresses, hours, policies, Q&A).
// These have higher priority than article-based knowledge in RAG.
type FAQ struct {
	ID        uint            `json:"id" gorm:"primaryKey"`
	CompanyID *uint           `json:"company_id" gorm:"index"`
	Slug      string          `json:"slug" gorm:"uniqueIndex;not null"`
	Title     string          `json:"title" gorm:"not null"`
	Category  string          `json:"category" gorm:"not null"` // info, faq, policy
	Priority  int             `json:"priority" gorm:"default:0"`
	Content   json.RawMessage `json:"content" gorm:"type:jsonb;default:'{}'"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

func SeedFAQ(db *gorm.DB) {
	var count int64
	db.Model(&FAQ{}).Count(&count)
	if count > 0 {
		return
	}

	companyID := uint(1)

	faqs := []FAQ{
		{
			CompanyID: &companyID,
			Slug:      "clinic_info",
			Title:     "О клинике",
			Category:  "info",
			Priority:  100,
			Content: json.RawMessage(`{
				"name": "Ветеринарная клиника Зоомедик",
				"description": "Сеть ветеринарных клиник. Работаем с 2005 года.",
				"branches": [
					{"name": "Дмитрия Ульянова", "address": "ул. Дмитрия Ульянова, д. 16", "phone": "+7 (495) 123-45-67", "hours": "круглосуточно", "features": ["терапия", "хирургия", "стоматология", "офтальмология"]},
					{"name": "Ленинский проспект", "address": "Ленинский проспект, д. 93", "phone": "+7 (495) 234-56-78", "hours": "09:00–21:00", "features": ["терапия", "хирургия", "кардиология"]},
					{"name": "Свобода", "address": "ул. Свободы, д. 14", "phone": "+7 (495) 345-67-89", "hours": "09:00–21:00", "features": ["терапия", "вакцинация", "хирургия"]},
					{"name": "Борисовские пруды", "address": "ул. Борисовские пруды, д. 16", "phone": "+7 (495) 456-78-90", "hours": "09:00–21:00", "features": ["терапия", "диагностика"]},
					{"name": "Коломенская набережная", "address": "Коломенская набережная, д. 14А", "phone": "+7 (495) 567-89-01", "hours": "09:00–21:00", "features": ["терапия", "хирургия", "стерилизация"]}
				],
				"emergency": "Экстренный приём круглосуточно на филиале Дмитрия Ульянова без записи",
				"website": "zoomedic.ru"
			}`),
		},
		{
			CompanyID: &companyID,
			Slug:      "general_policies",
			Title:     "Общие правила и политики",
			Category:  "policy",
			Priority:  90,
			Content: json.RawMessage(`{
				"appointment_rules": [
					"На филиале Дмитрия Ульянова забор анализов без записи, в порядке общей очереди",
					"На других филиалах рекомендуется запись по телефону или через контакт-центр",
					"Вакцинация — без записи на Дмитрия Ульянова, на других филиалах по записи",
					"Экстренный приём — без записи, круглосуточно на Дмитрия Ульянова"
				],
				"payment": ["Наличные", "Банковские карты", "СБП"],
				"preop_preparation": "Перед операцией под наркозом: голодная диета 8-12 часов, воду убрать за 4 часа",
				"documents": "При первом посещении оформляется карта пациента. Паспорт владельца не требуется."
			}`),
		},
		{
			CompanyID: &companyID,
			Slug:      "common_questions",
			Title:     "Часто задаваемые вопросы",
			Category:  "faq",
			Priority:  80,
			Content: json.RawMessage(`{
				"questions": [
					{"q": "Вы работаете круглосуточно?", "a": "Филиал на Дмитрия Ульянова работает круглосуточно. Остальные филиалы — с 09:00 до 21:00."},
					{"q": "Можно ли приехать без записи?", "a": "На Дмитрия Ульянова — да, в порядке общей очереди. На другие филиалы лучше записаться."},
					{"q": "Есть ли выезд врача на дом?", "a": "Да, есть выездная служба. Стоимость выезда от 3000 руб. в пределах МКАД."},
					{"q": "Какие анализы можно сдать?", "a": "Общий и биохимический анализ крови, анализ мочи, ПЦР-тесты, ИФА. Результаты экспресс-анализов — в день обращения."},
					{"q": "Сколько стоит приём?", "a": "Первичный приём терапевта — уточняйте в прайс-листе или у администратора. Стоимость зависит от специалиста."},
					{"q": "Нужна ли запись на вакцинацию?", "a": "На Дмитрия Ульянова — без записи. На других филиалах — по записи."},
					{"q": "Принимаете ли экзотических животных?", "a": "Да, принимаем. Рекомендуем уточнить наличие узкого специалиста при записи."},
					{"q": "Как подготовить животное к операции?", "a": "Голодная диета 8-12 часов, воду убрать за 4 часа до операции. Для пород риска (мейн-кун, шотландские, британские) рекомендуем ЭХО сердца перед наркозом."}
				]
			}`),
		},
		{
			CompanyID: &companyID,
			Slug:      "doctors",
			Title:     "Специалисты клиники",
			Category:  "info",
			Priority:  70,
			Content: json.RawMessage(`{
				"doctors": [
					{"name": "Орлов", "specialty": "Хирург", "branches": ["Дмитрия Ульянова", "Ленинский проспект"]},
					{"name": "Корбов", "specialty": "Кардиолог", "branches": ["Дмитрия Ульянова"]},
					{"name": "Маямсина И.Н.", "specialty": "Терапевт", "branches": ["Свобода"]},
					{"name": "Первушина Л.А.", "specialty": "Терапевт", "branches": ["Свобода"]},
					{"name": "Вертиховский", "specialty": "Уролог", "branches": ["Дмитрия Ульянова"]}
				],
				"note": "Расписание врачей может меняться. Уточняйте при записи."
			}`),
		},
	}

	for _, f := range faqs {
		if err := db.Create(&f).Error; err != nil {
			log.Printf("Failed to seed FAQ %s: %v", f.Slug, err)
		}
	}
	log.Printf("Seeded %d FAQ entries", len(faqs))
}
