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
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
