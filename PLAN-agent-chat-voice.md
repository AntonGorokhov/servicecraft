# Plan: AI Call-Center Agent — Chat + Voice

## Context

VetKB has a knowledge base (articles in PostgreSQL + Qdrant vectors) and a 974-service price tree. The next step is an **AI Agent** that operators can use to answer client questions — first as a chat interface, then as a real-time voice agent.

**User requirements:**
- RAG over KB articles + price list
- YandexGPT as the LLM
- SSE streaming for chat
- Chat history saved to DB
- Separate "Агент" tab in sidebar with reasoning/sources panel
- **Fast performance** (critical) — predictive RAG, minimal latency
- **Realistic voice** (even more critical) — Yandex SpeechKit
- **On-premises** deployment on powerful hardware (hardware is not a constraint)
- VAD (Voice Activity Detection) for voice phase
- Consider **Pipecat** framework for voice pipeline orchestration

**Architecture decision:** Phase 1 is pure Go (chat). Phase 2 adds Pipecat as a Python microservice for voice (VAD → STT → LLM → TTS), calling our Go backend for RAG/auth/data. This is the cleanest split — Go handles data & business logic, Pipecat handles real-time audio.

---

## Phase 1: Chat Agent (this plan)

### 1. Config — `backend/internal/config/config.go`

Add fields:
```
YandexGPTAPIKey   string  // YANDEX_GPT_API_KEY
YandexGPTFolderID string  // YANDEX_GPT_FOLDER_ID
YandexGPTModel    string  // YANDEX_GPT_MODEL (default: "yandexgpt/latest")
```

### 2. DB Models — `backend/internal/models/chat.go` (NEW)

```go
type ChatSession struct {
    ID        uint
    UserID    uint
    CompanyID *uint
    Title     string           // auto-generated from first message
    CreatedAt time.Time
    UpdatedAt time.Time
}

type ChatMessage struct {
    ID        uint
    SessionID uint
    Role      string           // "user" | "assistant"
    Content   string           // message text
    Sources   json.RawMessage  // [{slug, name, category, score}] — RAG sources
    CreatedAt time.Time
}
```

AutoMigrate in `main.go`.

### 3. Chat Service — `backend/internal/services/chat.go` (NEW)

CRUD for sessions and messages:
- `CreateSession(userID uint, companyID *uint, title string) → *ChatSession`
- `ListSessions(userID uint) → []ChatSession`
- `GetSession(sessionID, userID uint) → *ChatSession`
- `DeleteSession(sessionID, userID uint)`
- `AddMessage(sessionID uint, role, content string, sources json.RawMessage) → *ChatMessage`
- `GetMessages(sessionID uint) → []ChatMessage`

### 4. Yandex GPT Client — `backend/internal/agent/yandex.go` (NEW)

Streaming client for Yandex Foundation Models API:
- `POST https://llm.api.cloud.yandex.net/foundationModels/v1/completion`
- Auth: `Authorization: Api-Key <key>`, `x-folder-id: <folder>`
- Model URI: `gpt://<folder_id>/<model>` (e.g. `gpt://folder123/yandexgpt/latest`)
- Request body: `{modelUri, completionOptions: {stream: true, temperature, maxTokens}, messages: [{role, text}]}`
- Response: NDJSON stream — each line is `{"result": {"alternatives": [{"message": {"role", "text"}, "status": "..."}]}}`
- Parse NDJSON line-by-line, yield text deltas to caller via channel

```go
type YandexGPTClient struct { apiKey, folderID, model string }

func (c *YandexGPTClient) StreamCompletion(
    ctx context.Context,
    messages []Message,
    onChunk func(text string),
) error
```

### 5. Agent Service — `backend/internal/agent/agent.go` (NEW)

RAG orchestration:
```go
type AgentService struct {
    qdrant       *pipeline.QdrantService
    articles     *services.ArticleService
    prices       *services.PriceService
    pipeline     *pipeline.PipelineService  // for getEmbedding
    yandex       *YandexGPTClient
    chatService  *services.ChatService
}
```

**`Query(ctx, userMsg, sessionID, companyID, onChunk) → sources`:**
1. Embed user message → `pipeline.GetEmbedding(text)` (need to expose as public method)
2. Qdrant search → top 5 articles (threshold 0.5)
3. Fetch full article content for top 3 matches
4. Price match on user query → attach price info if relevant
5. Build system prompt with article context + price data
6. Load last N messages from session for conversation history
7. Stream YandexGPT response via `onChunk` callback
8. Save user message + assistant response + sources to DB
9. Return sources list for frontend

**System prompt** (Russian): instructs the agent to act as a vet clinic call-center operator, use only provided KB context, cite sources, give prices from price tree, escalate when unsure.

**Predictive RAG optimization:** Start embedding the user's message as soon as it arrives. If the session has history, also embed a combined "last assistant response + new user message" for better context continuity.

### 6. Expose Embedding — `backend/internal/pipeline/pipeline.go`

Add public wrapper:
```go
func (p *PipelineService) GetEmbedding(text string) ([]float32, error) {
    return p.getEmbedding(text)
}
```

### 7. Agent Handler — `backend/internal/handlers/agent.go` (NEW)

**`POST /api/agent/chat`** — SSE streaming endpoint:
- Input: `{"message": "...", "session_id": 0}` (session_id=0 → create new session)
- Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`
- SSE events:
  - `event: sources\ndata: [{slug, name, category, score}]\n\n` — sent first
  - `event: token\ndata: {"text": "..."}\n\n` — streamed tokens
  - `event: done\ndata: {"session_id": 123}\n\n` — final event
  - `event: error\ndata: {"error": "..."}\n\n` — on failure

**`GET /api/agent/sessions`** — list user's chat sessions

**`GET /api/agent/sessions/:id/messages`** — get session messages

**`DELETE /api/agent/sessions/:id`** — delete session

### 8. Route Wiring — `backend/cmd/api/main.go`

- AutoMigrate `ChatSession`, `ChatMessage`
- Create `ChatService`, `YandexGPTClient`, `AgentService`, `AgentHandler`
- Register routes under `protected`:
  ```
  POST   /api/agent/chat
  GET    /api/agent/sessions
  GET    /api/agent/sessions/:id/messages
  DELETE /api/agent/sessions/:id
  ```

### 9. Frontend SSE Hook — `frontend/src/hooks/useAgentChat.ts` (NEW)

Custom hook:
```ts
function useAgentChat() {
    // State: messages[], sources[], isStreaming, sessionId
    // sendMessage(text): POST /api/agent/chat with fetch() + ReadableStream
    // Parse SSE events: sources → set sources, token → append to current message, done → finalize
    // loadSession(id): fetch messages from API
    // sessions: list from API
}
```

Uses `fetch()` with `ReadableStream` reader (not EventSource — need POST support).

### 10. Agent Page — `frontend/src/pages/AgentPage.tsx` (NEW)

Two-panel layout:
- **Left panel (70%):** Chat interface
  - Session selector dropdown at top (with "Новый чат" button)
  - Message list: user messages right-aligned (blue), assistant left-aligned (white)
  - Assistant messages render Markdown
  - Input bar at bottom with send button
  - Streaming indicator (typing dots) during response

- **Right panel (30%):** Sources/reasoning
  - "Источники" header
  - Cards for each matched article: name, category, relevance score
  - Click → navigates to `/articles/:slug`
  - Price match section if prices were found
  - Click price → navigates to `/price-tree#tree_path`

### 11. Routing — `frontend/src/App.tsx`

Add: `<Route path="/agent" element={<AgentPage />} />`

### 12. Sidebar — `frontend/src/components/Sidebar.tsx`

Add "Агент" NavLink with chat-bubble icon. Visible to all authenticated users. Place after "Прайс".

### 13. Docker / Environment

- Add to `.env.example`: `YANDEX_GPT_API_KEY`, `YANDEX_GPT_FOLDER_ID`, `YANDEX_GPT_MODEL`
- Add to `docker-compose.yml`: pass env vars to backend service

---

## Phase 2: Voice Agent (future, not implemented now)

Architecture sketch for context:

- **Pipecat** Python microservice (`voice-agent/`) in docker-compose
- Pipeline: `WebRTC Transport → Silero VAD → Yandex SpeechKit STT (gRPC) → Context Aggregator → Go Backend RAG API → YandexGPT → Yandex SpeechKit TTS (gRPC) → WebRTC Transport`
- Custom Pipecat providers for Yandex STT/TTS (extend base `STTService`/`TTSService`)
- Go backend exposes internal `/api/agent/rag` endpoint (embedding + search + context assembly) for Pipecat to call
- Frontend adds WebRTC component for browser-based voice calls
- On-premises: Pipecat + all services on same powerful server, no external API calls except Yandex Cloud

---

## Files Summary

| # | File | Action |
|---|------|--------|
| 1 | `backend/internal/config/config.go` | ADD Yandex config fields |
| 2 | `backend/internal/models/chat.go` | NEW — ChatSession, ChatMessage |
| 3 | `backend/internal/services/chat.go` | NEW — session/message CRUD |
| 4 | `backend/internal/agent/yandex.go` | NEW — YandexGPT streaming client |
| 5 | `backend/internal/agent/agent.go` | NEW — RAG orchestration |
| 6 | `backend/internal/pipeline/pipeline.go` | ADD public GetEmbedding wrapper |
| 7 | `backend/internal/handlers/agent.go` | NEW — SSE endpoint + session routes |
| 8 | `backend/cmd/api/main.go` | Wire agent services + routes |
| 9 | `frontend/src/hooks/useAgentChat.ts` | NEW — SSE streaming hook |
| 10 | `frontend/src/pages/AgentPage.tsx` | NEW — chat UI + sources panel |
| 11 | `frontend/src/App.tsx` | ADD /agent route |
| 12 | `frontend/src/components/Sidebar.tsx` | ADD "Агент" nav link |
| 13 | `.env.example` | ADD Yandex env vars |
| 14 | `docker-compose.yml` | ADD env vars to backend |

## Verification

1. `go build ./cmd/api` — compiles
2. `npm run build` — compiles
3. Set `YANDEX_GPT_API_KEY` + `YANDEX_GPT_FOLDER_ID` in `.env`
4. `docker compose up --build`
5. Open `/agent` → type question → see SSE-streamed response with KB sources
6. Sources panel shows matched articles + prices
7. Click source → navigates to article detail
8. Session persists — reload page, select session, see history
9. New session → "Новый чат" button
