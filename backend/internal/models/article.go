package models

import (
	"encoding/json"
	"log"
	"time"

	"gorm.io/gorm"
)

type Article struct {
	ID          uint            `json:"id" gorm:"primaryKey"`
	CompanyID   *uint           `json:"company_id" gorm:"index"`
	Company     *Company        `json:"company,omitempty" gorm:"foreignKey:CompanyID"`
	Slug        string          `json:"slug" gorm:"uniqueIndex;not null"`
	Name        string          `json:"name" gorm:"not null"`
	Category    string          `json:"category" gorm:"not null"`
	CallCount   int             `json:"call_count" gorm:"default:0"`
	Steps       int             `json:"steps" gorm:"default:0"`
	Exceptions  int             `json:"exceptions" gorm:"default:0"`
	LastUpdated string          `json:"last_updated"`
	Content     json.RawMessage `json:"content" gorm:"type:jsonb;default:'{}'"`
	Embedding   json.RawMessage `json:"-" gorm:"type:jsonb"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

func SeedArticles(db *gorm.DB) {
	var count int64
	db.Model(&Article{}).Count(&count)
	if count > 0 {
		return
	}

	emptyContent := json.RawMessage(`{"trigger_phrases":[],"conversation_flow":[],"clarifying_questions":[],"exceptions":[],"services_and_prices":[],"red_flags":[],"never_say":[],"faq":[],"evidence":[]}`)

	catSterilizationContent := json.RawMessage(`{
  "trigger_phrases": [
    "хотим стерилизовать кошку",
    "сколько стоит стерилизация",
    "кошку нужно кастрировать",
    "когда лучше стерилизовать",
    "подготовка к стерилизации"
  ],
  "conversation_flow": [
    {"step": "Выяснить возраст и породу", "ask": "Сколько вашей кошечке лет и какая порода?", "why": "Возраст влияет на риски анестезии, порода — на доп. обследования"},
    {"step": "Уточнить состояние здоровья", "ask": "Есть ли хронические заболевания? Прививки сделаны?", "why": "Прививки должны быть актуальны, хронические заболевания — доп. подготовка"},
    {"step": "Объяснить подготовку", "say": "Перед операцией нужна голодная диета 8-12 часов. Воду можно давать за 4 часа до."},
    {"step": "Назвать стоимость и что входит", "say": "Стерилизация кошки — 5500 рублей. В стоимость входит: наркоз, операция, послеоперационная попона, наблюдение в клинике 2 часа."},
    {"step": "Предложить дату", "action": "check_slots", "doctor_role": "хирург", "say": "Давайте подберём удобную дату. У нас есть..."},
    {"step": "Подтвердить запись", "say": "Записала вас на {дата} в {время}. Не забудьте про голодную диету!"}
  ],
  "clarifying_questions": [
    {"question": "Кошка уже рожала?", "why": "У рожавших кошек операция сложнее, стоимость может отличаться", "impact": "Если рожала — предупредить о возможной более высокой цене"},
    {"question": "Кошка сейчас не в течке?", "why": "Во время течки операцию лучше отложить на 2 недели", "impact": "Если в течке — перенести запись"},
    {"question": "Есть ли непереносимость наркоза в анамнезе?", "why": "Редкий случай, но критически важный", "impact": "Если да — дополнительная консультация анестезиолога"}
  ],
  "exceptions": [
    {"condition": "Порода мейн-кун", "action": "Добавить ЭКГ и УЗИ сердца перед операцией (риск ГКМП)", "price_impact": "+2000₽ за кардиообследование"},
    {"condition": "Кошка старше 8 лет", "action": "Обязательный биохимический анализ крови перед операцией", "price_impact": "+1200₽ за анализ"},
    {"condition": "Кошка на свободном выгуле", "action": "Уточнить дату последней дегельминтизации, возможно нужна перед операцией", "price_impact": "+500₽ если нужна обработка"}
  ],
  "services_and_prices": [
    {"service": "Стерилизация кошки", "price": 5500, "currency": "₽", "includes": "наркоз, операция, попона, наблюдение 2ч", "mandatory": true},
    {"service": "ЭКГ", "price": 1500, "currency": "₽", "mandatory": false, "condition": "Для пород группы риска (мейн-кун, британская, шотландская)"},
    {"service": "УЗИ сердца", "price": 2600, "currency": "₽", "mandatory": false, "condition": "Для пород группы риска"},
    {"service": "Биохимический анализ крови", "price": 1200, "currency": "₽", "mandatory": false, "condition": "Кошки старше 8 лет"}
  ],
  "red_flags": [
    {"signal": "Кошка беременна", "action": "Не записывать на стандартную стерилизацию. Перевести на ветеринара для обсуждения.", "urgency": "urgent"},
    {"signal": "Кошка после операции плохо себя чувствует (звонок post-op)", "action": "Немедленно соединить с дежурным ветеринаром.", "urgency": "emergency"}
  ],
  "never_say": [
    "Не обещать конкретный исход операции",
    "Не говорить «это безопасная операция» — любая операция имеет риски",
    "Не давать медицинских рекомендаций по подготовке сверх стандартных",
    "Не сравнивать цены с другими клиниками"
  ],
  "faq": [
    {"q": "В каком возрасте лучше стерилизовать?", "a": "Оптимально с 7-8 месяцев. Но можно и позже — ветеринар оценит на приёме."},
    {"q": "Кошка будет толстеть после стерилизации?", "a": "Гормональный фон меняется, но при правильном питании вес контролируется. Врач даст рекомендации."},
    {"q": "Как быстро она восстановится?", "a": "Обычно 7-10 дней. Швы снимают через 10-14 дней, если не саморассасывающиеся."},
    {"q": "Нужно ли оставлять на ночь?", "a": "Обычно нет, через 2 часа после операции можно забирать. Но если хотите — можем оставить на стационар."}
  ],
  "evidence": [
    {"call_id": "2026-01-24_14-05-18_9602355445_411331575", "quote": "Стерилизация кошки у нас стоит 5500 рублей, туда входит наркоз, сама операция, попонка послеоперационная", "timestamp_sec": 145.2},
    {"call_id": "2026-02-05_11-19-32_9039624835_424195916", "quote": "Если мейн-кун, то мы рекомендуем перед операцией сделать ЭКГ, потому что у них бывает кардиомиопатия", "timestamp_sec": 203.7},
    {"call_id": "2026-02-16_14-40-40_9777152573_436127698", "quote": "Голодная диета минимум 8 часов перед операцией, водичку можно за 4 часа убрать", "timestamp_sec": 89.1}
  ]
}`)

	articles := []Article{
		{Slug: "cat_sterilization", Name: "Стерилизация кошки", Category: "preventive", CallCount: 12, Steps: 6, Exceptions: 3, LastUpdated: "1 мар", Content: catSterilizationContent},
		{Slug: "blood_in_urine", Name: "Кровь в моче", Category: "urological", CallCount: 8, Steps: 4, Exceptions: 2, LastUpdated: "28 фев", Content: emptyContent},
		{Slug: "poisoning", Name: "Отравление", Category: "emergency", CallCount: 3, Steps: 5, Exceptions: 2, LastUpdated: "25 фев", Content: emptyContent},
		{Slug: "price_inquiry", Name: "Узнать цену", Category: "admin", CallCount: 15, Steps: 3, Exceptions: 1, LastUpdated: "2 мар", Content: emptyContent},
		{Slug: "dog_vaccination", Name: "Вакцинация щенка", Category: "preventive", CallCount: 7, Steps: 5, Exceptions: 2, LastUpdated: "27 фев", Content: emptyContent},
		{Slug: "tick_bite", Name: "Укус клеща", Category: "emergency", CallCount: 5, Steps: 4, Exceptions: 3, LastUpdated: "26 фев", Content: emptyContent},
	}

	for _, a := range articles {
		if err := db.Create(&a).Error; err != nil {
			log.Printf("Failed to seed article %s: %v", a.Slug, err)
		}
	}
	log.Printf("Seeded %d demo articles", len(articles))
}
