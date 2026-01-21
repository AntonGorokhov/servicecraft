package config

import "os"

type Config struct {
	PostgresHost     string
	PostgresPort     string
	PostgresUser     string
	PostgresPassword string
	PostgresDB       string
	JWTSecret        string
	AdminEmail       string
	AdminPassword    string
	ReplicateToken    string
	OpenAIAPIKey      string
	QdrantHost        string
	QdrantPort        string
	YandexGPTAPIKey   string
	YandexGPTFolderID string
	YandexGPTModel    string
	LiveKitAPIKey     string
	LiveKitAPISecret  string
	LiveKitURL        string
}

func Load() *Config {
	return &Config{
		PostgresHost:     getEnv("POSTGRES_HOST", "localhost"),
		PostgresPort:     getEnv("POSTGRES_PORT", "5432"),
		PostgresUser:     getEnv("POSTGRES_USER", "vetkb"),
		PostgresPassword: getEnv("POSTGRES_PASSWORD", "vetkb_secret"),
		PostgresDB:       getEnv("POSTGRES_DB", "vetkb"),
		JWTSecret:        getEnv("JWT_SECRET", "dev-secret-change-me"),
		AdminEmail:       getEnv("ADMIN_EMAIL", "admin@vetkb.local"),
		AdminPassword:    getEnv("ADMIN_PASSWORD", "admin123"),
		ReplicateToken:   getEnv("REPLICATE_API_TOKEN", ""),
		OpenAIAPIKey:     getEnv("OPENAI_API_KEY", ""),
		QdrantHost:        getEnv("QDRANT_HOST", "localhost"),
		QdrantPort:        getEnv("QDRANT_PORT", "6333"),
		YandexGPTAPIKey:   getEnv("YANDEX_GPT_API_KEY", ""),
		YandexGPTFolderID: getEnv("YANDEX_GPT_FOLDER_ID", ""),
		YandexGPTModel:    getEnv("YANDEX_GPT_MODEL", "yandexgpt-lite/latest"),
		LiveKitAPIKey:     getEnv("LIVEKIT_API_KEY", "devkey"),
		LiveKitAPISecret:  getEnv("LIVEKIT_API_SECRET", "devsecret"),
		LiveKitURL:        getEnv("LIVEKIT_URL", "ws://localhost:7880"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
