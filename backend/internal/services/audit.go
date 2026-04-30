package services

import (
	"encoding/json"
	"time"

	"github.com/vetkb/backend/internal/models"
	"gorm.io/gorm"
)

type AuditService struct {
	db *gorm.DB
}

func NewAuditService(db *gorm.DB) *AuditService {
	return &AuditService{db: db}
}

func (s *AuditService) Log(userID, companyID *uint, action, resource, resourceID, ipAddress, userAgent string, details interface{}) {
	detailsJSON, _ := json.Marshal(details)
	entry := models.AuditLog{
		UserID:     userID,
		CompanyID:  companyID,
		Action:     action,
		Resource:   resource,
		ResourceID: resourceID,
		Details:    detailsJSON,
		IPAddress:  ipAddress,
		UserAgent:  userAgent,
	}
	s.db.Create(&entry)
}

type AuditFilter struct {
	CompanyID  *uint
	UserID     *uint
	Action     string
	Resource   string
	StartDate  *time.Time
	EndDate    *time.Time
	Limit      int
	Offset     int
}

func (s *AuditService) List(filter AuditFilter) ([]models.AuditLog, int64, error) {
	q := s.db.Model(&models.AuditLog{})
	if filter.CompanyID != nil {
		q = q.Where("company_id = ?", *filter.CompanyID)
	}
	if filter.Action != "" {
		q = q.Where("action = ?", filter.Action)
	}
	if filter.Resource != "" {
		q = q.Where("resource = ?", filter.Resource)
	}
	if filter.StartDate != nil {
		q = q.Where("created_at >= ?", *filter.StartDate)
	}
	if filter.EndDate != nil {
		q = q.Where("created_at <= ?", *filter.EndDate)
	}

	var total int64
	q.Count(&total)

	if filter.Limit <= 0 {
		filter.Limit = 50
	}

	var logs []models.AuditLog
	err := q.Order("created_at DESC").Offset(filter.Offset).Limit(filter.Limit).Find(&logs).Error
	return logs, total, err
}

type AuditStats struct {
	TotalEvents    int64            `json:"total_events"`
	EventsByAction map[string]int64 `json:"events_by_action"`
	EventsByDay    []DayStat        `json:"events_by_day"`
}

type DayStat struct {
	Date  string `json:"date"`
	Count int64  `json:"count"`
}

func (s *AuditService) Stats(companyID *uint, days int) (*AuditStats, error) {
	stats := &AuditStats{EventsByAction: make(map[string]int64)}
	since := time.Now().AddDate(0, 0, -days)
	q := s.db.Model(&models.AuditLog{}).Where("created_at >= ?", since)
	if companyID != nil {
		q = q.Where("company_id = ?", *companyID)
	}

	q.Count(&stats.TotalEvents)

	var actionCounts []struct {
		Action string
		Count  int64
	}
	q.Select("action, count(*) as count").Group("action").Scan(&actionCounts)
	for _, ac := range actionCounts {
		stats.EventsByAction[ac.Action] = ac.Count
	}

	var dayCounts []struct {
		Date  string
		Count int64
	}
	q.Select("DATE(created_at) as date, count(*) as count").Group("DATE(created_at)").Order("date").Scan(&dayCounts)
	for _, dc := range dayCounts {
		stats.EventsByDay = append(stats.EventsByDay, DayStat{Date: dc.Date, Count: dc.Count})
	}

	return stats, nil
}
