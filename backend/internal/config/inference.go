package config

import "os"

type InferenceConfig struct {
	Mode string // "cloud" or "local"

	// Local embedding service (e.g. TEI, vLLM with embedding model)
	LocalEmbeddingURL   string
	LocalEmbeddingModel string
	LocalEmbeddingDim   int

	// Local STT service (e.g. faster-whisper-server)
	LocalSTTURL   string
	LocalSTTModel string

	// Local LLM via Ollama
	OllamaURL   string
	OllamaModel string

	// GPU settings
	GPUDevices    string
	GPUMemoryFrac float64
}

func LoadInferenceConfig() InferenceConfig {
	cfg := InferenceConfig{
		Mode: getEnvDefault("INFERENCE_MODE", "cloud"),

		LocalEmbeddingURL:   getEnvDefault("LOCAL_EMBEDDING_URL", "http://localhost:8081"),
		LocalEmbeddingModel: getEnvDefault("LOCAL_EMBEDDING_MODEL", "intfloat/multilingual-e5-large"),
		LocalEmbeddingDim:   1024,

		LocalSTTURL:   getEnvDefault("LOCAL_STT_URL", "http://localhost:8082"),
		LocalSTTModel: getEnvDefault("LOCAL_STT_MODEL", "large-v3"),

		OllamaURL:   getEnvDefault("OLLAMA_URL", "http://localhost:11434"),
		OllamaModel: getEnvDefault("OLLAMA_MODEL", "qwen3:14b"),

		GPUDevices:    getEnvDefault("GPU_DEVICES", "0"),
		GPUMemoryFrac: 0.9,
	}

	return cfg
}

func getEnvDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}
