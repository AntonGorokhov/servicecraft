package yclients

import (
	"fmt"
	"strings"
	"time"
)

// Slot represents an available appointment slot.
type Slot struct {
	ID          string `json:"id"`
	Date        string `json:"date"`
	Time        string `json:"time"`
	DateTime    string `json:"datetime"`
	Doctor      string `json:"doctor"`
	Specialty   string `json:"specialty"`
	Branch      string `json:"branch"`
	ServiceName string `json:"service_name"`
}

// Booking represents a confirmed appointment.
type Booking struct {
	BookingID   string `json:"booking_id"`
	SlotID      string `json:"slot_id"`
	PetName     string `json:"pet_name"`
	OwnerPhone  string `json:"owner_phone"`
	Doctor      string `json:"doctor"`
	DateTime    string `json:"datetime"`
	Branch      string `json:"branch"`
	Status      string `json:"status"`
	SMSSent     bool   `json:"sms_sent"`
}

// Patient holds mock patient information.
type Patient struct {
	OwnerName string `json:"owner_name"`
	Phone     string `json:"phone"`
	PetName   string `json:"pet_name"`
	Breed     string `json:"breed"`
	Species   string `json:"species"`
	BirthYear int    `json:"birth_year"`
}

var mockDoctors = []struct {
	Name      string
	Specialty string
	Branch    string
}{
	{"Орлов А.В.", "Хирург", "Дмитрия Ульянова"},
	{"Корбов М.И.", "Кардиолог", "Дмитрия Ульянова"},
	{"Маямсина И.Н.", "Терапевт", "Свобода"},
	{"Первушина Л.А.", "Терапевт", "Свобода"},
	{"Вертиховский С.Е.", "Уролог", "Дмитрия Ульянова"},
}

var mockPatients = map[string]Patient{
	"79031234567": {OwnerName: "Иванова Мария", Phone: "79031234567", PetName: "Барсик", Breed: "Мейн-кун", Species: "кошка", BirthYear: 2021},
	"79167654321": {OwnerName: "Петров Алексей", Phone: "79167654321", PetName: "Рекс", Breed: "Лабрадор", Species: "собака", BirthYear: 2019},
	"79055550000": {OwnerName: "Сидорова Анна", Phone: "79055550000", PetName: "Мурка", Breed: "Британская", Species: "кошка", BirthYear: 2020},
}

// GetSlots returns mock available appointment slots for the next 7 days.
func GetSlots(service string) []Slot {
	now := time.Now()
	times := []string{"09:00", "10:30", "11:00", "13:00", "14:30", "15:00", "16:30", "17:00", "18:30"}

	var slots []Slot
	slotIdx := 0
	for day := 1; day <= 7; day++ {
		date := now.AddDate(0, 0, day)
		if date.Weekday() == time.Sunday {
			continue
		}
		dateStr := date.Format("02.01.2006")
		dayTimes := times[slotIdx%3 : slotIdx%3+3]

		doctor := mockDoctors[day%len(mockDoctors)]
		for _, t := range dayTimes {
			slots = append(slots, Slot{
				ID:          fmt.Sprintf("slot_%d_%s", day, strings.ReplaceAll(t, ":", "")),
				Date:        dateStr,
				Time:        t,
				DateTime:    fmt.Sprintf("%s %s", dateStr, t),
				Doctor:      doctor.Name,
				Specialty:   doctor.Specialty,
				Branch:      doctor.Branch,
				ServiceName: service,
			})
		}
		slotIdx++
	}
	return slots
}

// BookSlot creates a mock appointment booking.
func BookSlot(slotID, petName, phone string) (*Booking, error) {
	slots := GetSlots("")
	var found *Slot
	for i := range slots {
		if slots[i].ID == slotID {
			found = &slots[i]
			break
		}
	}
	if found == nil {
		return nil, fmt.Errorf("slot not found: %s", slotID)
	}
	return &Booking{
		BookingID:  fmt.Sprintf("bk_%d", time.Now().UnixNano()%100000),
		SlotID:     slotID,
		PetName:    petName,
		OwnerPhone: phone,
		Doctor:     found.Doctor,
		DateTime:   found.DateTime,
		Branch:     found.Branch,
		Status:     "confirmed",
		SMSSent:    true,
	}, nil
}

// GetPatient looks up a mock patient by phone number.
func GetPatient(phone string) (*Patient, bool) {
	// Normalise: strip non-digits, keep last 11
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, phone)
	if len(digits) > 11 {
		digits = digits[len(digits)-11:]
	}
	p, ok := mockPatients[digits]
	if !ok {
		return nil, false
	}
	return &p, true
}

// AppointmentIntentKeywords are Russian phrases that trigger CRM lookup.
var AppointmentIntentKeywords = []string{
	"записаться", "запись", "записать", "записывает", "запишите",
	"свободное время", "свободный", "ближайшее время", "когда можно",
	"к врачу", "на приём", "на прием", "приём", "прием",
	"слот", "доступно", "принимает сегодня", "принимает завтра",
}

// HasAppointmentIntent returns true if the query likely asks about booking.
func HasAppointmentIntent(query string) bool {
	lower := strings.ToLower(query)
	for _, kw := range AppointmentIntentKeywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}

// FormatSlotsContext formats available slots for LLM context injection.
func FormatSlotsContext(slots []Slot) string {
	if len(slots) == 0 {
		return ""
	}
	var sb strings.Builder
	sb.WriteString("[YClients] Доступные слоты для записи:\n")
	limit := 6
	if len(slots) < limit {
		limit = len(slots)
	}
	for _, s := range slots[:limit] {
		sb.WriteString(fmt.Sprintf("  • %s %s — %s (%s), %s\n", s.Date, s.Time, s.Doctor, s.Specialty, s.Branch))
	}
	if len(slots) > limit {
		sb.WriteString(fmt.Sprintf("  ... и ещё %d слотов\n", len(slots)-limit))
	}
	return sb.String()
}
