package models

import "time"

// TTSCache stores synthesized audio keyed by SHA256(text+voice) to avoid
// re-calling the OpenAI TTS API for identical requests.
type TTSCache struct {
	ID        uint      `gorm:"primaryKey"`
	TextHash  string    `gorm:"uniqueIndex;not null"` // SHA256(text + "|" + voice)
	AudioData []byte    `gorm:"type:bytea;not null"`
	CreatedAt time.Time
}
