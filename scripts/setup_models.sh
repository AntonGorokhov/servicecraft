#!/bin/bash
set -euo pipefail

OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"

echo "=== ServiceCraft Local Model Setup ==="
echo ""

# Check Ollama
echo "[1/3] Checking Ollama..."
if ! curl -sf "$OLLAMA_URL/api/tags" > /dev/null 2>&1; then
    echo "ERROR: Ollama is not running at $OLLAMA_URL"
    echo "Start it with: docker compose -f docker-compose.local-gpu.yml up ollama -d"
    exit 1
fi
echo "  Ollama is running"

# Pull LLM model
echo ""
echo "[2/3] Pulling LLM model (qwen3:14b)..."
curl -sf "$OLLAMA_URL/api/pull" -d '{"name": "qwen3:14b"}' | while read -r line; do
    status=$(echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || true)
    if [ -n "$status" ]; then
        echo "  $status"
    fi
done
echo "  Done"

# Verify
echo ""
echo "[3/3] Verifying models..."
models=$(curl -sf "$OLLAMA_URL/api/tags" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for m in data.get('models', []):
    size_gb = m.get('size', 0) / 1e9
    print(f\"  - {m['name']} ({size_gb:.1f} GB)\")
" 2>/dev/null || echo "  (could not list models)")
echo "$models"

echo ""
echo "=== Setup complete ==="
echo ""
echo "Start all services:"
echo "  docker compose -f docker-compose.local-gpu.yml up -d"
echo ""
echo "Environment variables for local inference:"
echo "  INFERENCE_MODE=local"
echo "  OLLAMA_URL=$OLLAMA_URL"
echo "  OLLAMA_MODEL=qwen3:14b"
