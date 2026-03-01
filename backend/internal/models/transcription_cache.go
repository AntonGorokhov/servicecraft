package models

import (
	"encoding/json"
	"time"
)

// TranscriptionCache stores STT results keyed by audio file hash to avoid
// re-transcribing the same file.
type TranscriptionCache struct {
	ID         uint            `json:"id" gorm:"primaryKey"`
	FileHash   string          `json:"file_hash" gorm:"uniqueIndex;not null"` // SHA256 of audio bytes
	FileName   string          `json:"file_name"`
	Transcript string          `json:"transcript" gorm:"type:text;not null"`          // plain text (speaker-labeled)
	Segments   json.RawMessage `json:"segments" gorm:"type:jsonb"`                    // diarized segments with timestamps
	AudioPath  string          `json:"audio_path" gorm:"type:text"`                   // path to stored audio file
	CreatedAt  time.Time       `json:"created_at"`
}

// DiarizedSegment represents one speaker segment from whisper-diarization.
type DiarizedSegment struct {
	Speaker string  `json:"speaker"`
	Text    string  `json:"text"`
	Start   float64 `json:"start"`
	End     float64 `json:"end"`
}
