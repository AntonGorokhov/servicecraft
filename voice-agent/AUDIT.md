# Аудит репозитория: готовность к real-time voice агенту

**Дата:** 2026-03-04

---

## 1. Embeddings — где и как вычисляются?

**Replicate API используется. Модель: `lucataco/qwen3-embedding-8b`**

- **Файл:** `backend/internal/pipeline/pipeline.go` (строки 168–212)
- **Клиент Replicate:** `backend/internal/pipeline/replicate.go`
- **Размерность:** 1024, метрика: cosine
- **Вызов:** `PipelineService.GetEmbedding(text)` → Replicate API (`Prefer: wait` + polling fallback до 120 итераций по 5 сек)
- **Примерное время:** зависит от Replicate cold start; типично 1–5 сек на один embedding

**Где используются:**
1. Pipeline-обработка сегментов (pipeline.go:287)
2. RAG-поиск в агенте (agent.go:81)
3. Индексация статей в Qdrant (pipeline.go:231–245)

**Вывод:** Replicate — внешний API с непредсказуемой задержкой. Для real-time voice агента это bottleneck.

---

## 2. RAG pipeline — что уже есть в Go-бэкенде?

**Все три сервиса существуют и работают:**

| Сервис | Файл | Статус |
|--------|------|--------|
| AgentService | `backend/internal/agent/agent.go` | Рабочий |
| YandexGPTClient | `backend/internal/agent/yandex.go` | Рабочий |
| ChatService | `backend/internal/services/chat.go` | Рабочий |

**RAG flow (agent.go, строки 73–161):**
1. Embed сообщения пользователя → Replicate API
2. Поиск в Qdrant (`topK=5`, `threshold=0.5`)
3. Загрузка полного контента top-3 статей из PostgreSQL
4. Price matching по прайс-дереву
5. Сборка system prompt (KB-контекст + прайсы + правила)
6. Загрузка истории (до 20 сообщений)
7. Стриминг ответа через YandexGPT
8. Сохранение user/assistant сообщений + sources в БД

---

## 3. YandexGPT streaming — реализован?

**Да, полностью реализован.**

- **Файл:** `backend/internal/agent/yandex.go` (строки 43–117)
- **Endpoint:** `https://llm.api.cloud.yandex.net/foundationModels/v1/completion`
- **Модель:** конфигурируется через env (default: `yandexgpt-lite/latest`)
- **Temperature:** 0.3, max tokens: 2000

**Парсинг NDJSON-стрима:**
- Каждая строка содержит **полный накопленный текст**
- Алгоритм вычисляет дельту: `delta = fullText[len(prevText):]`
- Только новые символы передаются в `onChunk` callback
- Буфер сканера: до 1MB

**Обработка ошибок:**
- HTTP статус != 200 → ошибка с телом ответа
- Ошибки сканера → проброс через `scanner.Err()`
- Некорректный JSON → `continue` (silent skip)
- **Таймаут:** 120 сек на HTTP-клиенте

---

## 4. SSE endpoint — работает?

**Да, полностью работает. Фронтенд подключён.**

- **Route:** `POST /api/agent/chat` (main.go:114, protected — JWT)
- **Handler:** `backend/internal/handlers/agent.go` (строки 31–100)

**SSE события:**
| Событие | Данные | Когда |
|---------|--------|-------|
| `token` | `{"text": "..."}` | Каждый чанк от YandexGPT |
| `sources` | `[{id, title, ...}]` | После завершения генерации |
| `done` | `{"session_id": N}` | Финальный сигнал |
| `error` | `{"error": "..."}` | При ошибке стрима |

**Фронтенд:** `frontend/src/hooks/useAgentChat.ts` (строки 84–195)
- `fetch()` + `ReadableStream` reader
- Парсинг SSE-формата вручную (event: / data:)
- Накопление токенов в сообщение ассистента

---

## 5. Sentence boundary detection — есть ли буферизация перед TTS?

**Не реализовано.**

- Токены отправляются клиенту сразу по мере получения от YandexGPT
- Нет буферизации до знаков препинания
- Нет компонента sentence boundary detection

**Однако в voice-agent/server.py** TTS-функция уже разбивает текст на предложения (до 250 символов) перед отправкой в SpeechKit TTS. Это работает для `/api/agent/rag` (non-streaming), где полный ответ приходит целиком.

**Для Phase 2 (streaming TTS):** потребуется буферизация токенов до `.?!` перед отправкой в TTS — этого компонента пока нет.

---

## 6. Pipecat — принято ли решение?

**Pipecat НЕ используется. Написан собственный voice pipeline на Python/FastAPI.**

- **Директория:** `voice-agent/`
- **Стек:** FastAPI + WebSocket + Yandex SpeechKit gRPC
- **Файлы:**
  - `server.py` — основной сервер
  - `Dockerfile` — Python 3.11, компиляция proto-файлов
  - `pyproject.toml` — зависимости

**Реализовано:**
| Компонент | Реализация |
|-----------|------------|
| **VAD** | Встроенный в Yandex SpeechKit STT (EOU detection) |
| **STT** | Yandex SpeechKit gRPC streaming (`stt.api.cloud.yandex.net:443`) |
| **LLM** | Делегируется Go-бэкенду через `/api/agent/rag` |
| **TTS** | Yandex SpeechKit TTS gRPC, голос `marina`, роль `friendly` |

**WebSocket протокол (`/ws`):**
- Клиент → сервер: бинарные PCM-чанки (16kHz, 16-bit mono, 100ms)
- Сервер → клиент: JSON-сообщения (`partial`, `transcript`, `response`, `audio_end`, `status`)
- Сервер → клиент: бинарные PCM-чанки TTS

---

## 7. /api/agent/rag — внутренний endpoint для voice-agent

**Да, существует и используется.**

- **Route:** `POST /api/agent/rag` (main.go:86, **без аутентификации** — Docker network only)
- **Handler:** `backend/internal/handlers/agent.go` (строки 102–124)

**Запрос:**
```json
{"text": "string", "session_id": 123, "company_id": 1}
```

**Ответ:**
```json
{"response": "полный текст ответа", "sources": [...]}
```

- **Non-streaming** — возвращает полный ответ целиком
- Внутри вызывает `QuerySync()` → полный RAG pipeline (embed → Qdrant → articles → YandexGPT)
- Voice-agent вызывает его через `aiohttp` с таймаутом 30 сек

---

## 8. Кеширование частых запросов

**Не реализовано.**

- Нет Redis, LRU-кеша, или любого другого кеширования
- Каждый запрос проходит полный цикл: Replicate embedding → Qdrant search → PostgreSQL fetch → YandexGPT
- **Кандидаты на кеширование (не реализованы):**
  - Embeddings для частых фраз ("часы работы", "адрес", "цена")
  - Результаты Qdrant-поиска
  - Price tree lookups
  - Полные ответы на типовые вопросы

---

## 9. Barge-in / отмена генерации

**Не реализовано.**

- `YandexGPTClient.StreamCompletion()` принимает `ctx context.Context` и создаёт запрос через `http.NewRequestWithContext(ctx, ...)` — теоретически HTTP-запрос отменится при cancel контекста
- **Но:** нигде не вызывается `context.WithCancel()` для прерывания стрима
- Replicate polling loop (`replicate.go:100–136`) не проверяет `ctx.Done()` — цикл на 120 итераций по 5 сек без возможности прерывания
- Voice-agent использует флаг `processing = True` — не может прервать RAG/TTS
- **Нет механизма barge-in:** если пользователь говорит во время ответа, его речь игнорируется до завершения текущего цикла

---

## 10. Текущий стек инфраструктуры

**docker-compose.yml — 5 сервисов:**

| Сервис | Образ | Порт | Зависимости |
|--------|-------|------|-------------|
| **postgres** | PostgreSQL 16 Alpine | 5432 | — |
| **backend** | Go 1.24 Alpine | 8080 | postgres (healthy) |
| **frontend** | Node/Vite | 3000 | backend, voice-agent |
| **voice-agent** | Python 3.11 FastAPI | 7860 | backend |
| **qdrant** | qdrant/qdrant:latest | 6333, 6334 | — |

**Hot-reload:** docker compose watch настроен для backend и frontend.

**GPU:**
- **НЕТ GPU-конфигурации** нигде в docker-compose.yml
- Нет `device_requests`, `runtime: nvidia`, CUDA
- Все сервисы работают на CPU
- Embeddings вычисляются через Replicate API (удалённо)
- STT/TTS — через Yandex SpeechKit API (удалённо)

---

## Сводная таблица

| # | Вопрос | Статус | Детали |
|---|--------|--------|--------|
| 1 | Embeddings | Replicate API | Qwen3-8B, 1024-dim, bottleneck для real-time |
| 2 | RAG pipeline | Готов | AgentService + YandexGPT + ChatService |
| 3 | YandexGPT streaming | Готов | NDJSON delta parsing, 120s timeout |
| 4 | SSE endpoint | Готов | token/sources/done события, фронт подключён |
| 5 | Sentence boundary | Не реализовано | Нужен буфер перед TTS для streaming |
| 6 | Pipecat | Не используется | Собственный FastAPI + SpeechKit gRPC |
| 7 | /api/agent/rag | Готов | Non-streaming, без auth, Docker-only |
| 8 | Кеширование | Не реализовано | Полный RAG на каждый запрос |
| 9 | Barge-in | Не реализовано | Нет context cancel, нет прерывания |
| 10 | Инфраструктура | 5 сервисов | CPU-only, нет GPU |
