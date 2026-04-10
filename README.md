# ServiceCraft — Интеллектуальная база знаний колл-центра ветеринарной клиники

Мультитенантная платформа для автоматизации колл-центров ветеринарных клиник. Система накапливает базу знаний из реальных звонков, позволяет операторам редактировать и утверждать Q&A-пары, а затем отвечает на вопросы клиентов через чат и голосовой агент.

---

## Содержание

- [Архитектура](#архитектура)
- [Функциональность](#функциональность)
- [Технологический стек](#технологический-стек)
- [Схема данных](#схема-данных)
- [API](#api)
- [Запуск](#запуск)
- [Переменные окружения](#переменные-окружения)

---

## Архитектура

Система состоит из двух функциональных слоёв.

### Слой 1 — HiTL Knowledge Base Pipeline (основной)

Human-in-the-Loop подход: вопросы из реальных звонков → очередь скриптования → оператор утверждает ответ → пара попадает в RAG-индекс → агент отвечает на основе утверждённой базы.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         HiTL Pipeline                               │
│                                                                     │
│  798 вопросов из звонков                                            │
│  (импорт knowledgeos JSON)                                          │
│           │                                                         │
│           ▼                                                         │
│  ┌─────────────────┐     ┌──────────────────┐                      │
│  │  Очередь /queue │     │  YandexGPT       │                      │
│  │  (unscripted)   │────▶│  черновик ответа │                      │
│  └─────────────────┘     └────────┬─────────┘                      │
│           │                       │ оператор редактирует/утверждает │
│           ▼                       ▼                                 │
│  ┌──────────────────────────────────────────┐                      │
│  │         PostgreSQL: questions            │                      │
│  │  question | answer | frequency | theme   │                      │
│  └──────────────────┬───────────────────────┘                      │
│                     │ rag_approved = true                           │
│                     ▼                                               │
│  ┌──────────────────────────────────────────┐                      │
│  │      Qdrant: qa_pairs collection         │                      │
│  │  dense (OpenAI 1024d) + sparse (BM25)    │                      │
│  └──────────────────┬───────────────────────┘                      │
│                     │                                               │
│                     ▼                                               │
│  ┌──────────────────────────────────────────┐                      │
│  │  Hybrid RAG Agent                        │                      │
│  │  dense + sparse → RRF → FAQ context      │                      │
│  │  → YandexGPT Pro → ответ клиенту         │                      │
│  └──────────────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Слой 2 — Legacy Audio Pipeline

Автоматическое создание статей базы знаний из аудиозаписей звонков. Реализован как альтернативный подход к наполнению KB.

```
Аудиофайл
    │
    ▼
gpt-4o-transcribe (Replicate) ──── SHA256-кэш (transcription_cache)
    │
    ▼
YandexGPT: сегментация по темам
    │
    ▼
Qdrant: поиск похожих статей (cosine > 0.50)
    │
    ├── статья найдена → YandexGPT обогащает содержимое
    └── не найдена    → создаётся новая статья
```

### Голосовой агент (LiveKit)

```
Браузер (микрофон)
    │
    ▼ WebRTC
LiveKit Room
    │
    ▼
Python LiveKit Agent
    ├── STT: gpt-4o-transcribe
    ├── RAG: FastEmbed (local ONNX) + Qdrant direct
    ├── LLM: GPT-4o-mini (streaming)
    └── TTS: OpenAI TTS (nova/shimmer/echo)
    │
    ▼ WebRTC audio
Браузер (динамик)
```

### Разговорный режим (Web Speech API)

Второй голосовой режим — без LiveKit, полностью на стороне браузера и Go-бэкенда:

```
Браузер
    │ Web Speech API (ru-RU)
    ▼
/api/agent/chat (SSE streaming)
    │ YandexGPT
    ▼
/api/agent/tts + DB cache
    │ OpenAI TTS
    ▼
Браузер (Audio API)
    │ onended
    ▼
[повтор цикла]
```

---

## Функциональность

### Чат-агент `/agent`

Текстовый чат с RAG-агентом. Поддерживает:
- **Потоковую передачу ответа** (SSE) с отображением источников
- **Голосовой ввод** через Web Speech API (кнопка-микрофон)
- **Озвучку ответов** — кнопка play на каждом сообщении (OpenAI TTS)
- **Разговорный режим** — зелёная кнопка-телефон запускает автоматический цикл «слушаю → думаю → говорю»
- **Историю сессий** — сохраняется в localStorage и в PostgreSQL
- **Выбор голоса** — nova / shimmer / echo / alloy / fable / onyx

### Очередь вопросов `/questions`

Список вопросов без ответа (`status = unscripted`), отсортированных по частоте упоминания в звонках:
- **Генерация черновика** через YandexGPT на основе FAQ-контекста
- **Inline-редактирование** ответа + утверждение → синхронная индексация в Qdrant
- Фильтрация по теме, полнотекстовый поиск
- Импорт / экспорт JSON
- Массовое переиндексирование

### База Q&A `/qa`

Все отвеченные пары:
- Редактирование и переиндексирование на лету
- Бейдж «В RAG» с датой последней индексации

### Аналитика `/analytics`

- KPI: покрытие базы знаний, количество Q&A-пар, LLM acceptance rate
- RAG-метрики на тестовой выборке: BLEU, ROUGE-L, BERTScore
- Топ-10 вопросов по частоте

### FAQ `/faq`

Статические данные клиники: адреса, часы, врачи, правила приёма. Загружаются в контекст агента с наивысшим приоритетом.

### База знаний — статьи `/articles`

Статьи, созданные Legacy Pipeline. Редактируемая wiki; в RAG чат-агента не используются.

### Пайплайн `/pipeline`

Загрузка аудиофайлов звонков (до 20 файлов, 5 параллельных воркеров):
- Просмотр транскриптов с разметкой по спикерам
- Таблица сегментов с оценкой схожести с существующими статьями
- Воспроизведение фрагментов аудио прямо в браузере

### Прайс-дерево `/price-tree`

Иерархическое дерево услуг и цен. Используется агентом для ответов на вопросы о стоимости (keyword matching).

### Карта кластеров `/clusters`

D3.js force-directed граф семантических кластеров статей.

### Граф диалогов `/graph`

Визуализация типичных сценариев диалогов как графа переходов между темами.

### Настройки `/settings`

- Confidence threshold для RAG
- YClients API (CRM-интеграция)
- TTS voice по умолчанию

---

## Технологический стек

| Компонент | Технология |
|-----------|-----------|
| **Backend** | Go 1.24, Gin, GORM |
| **Frontend** | React 19, TypeScript, Vite 6, Tailwind CSS v4 |
| **База данных** | PostgreSQL 16 |
| **Векторная БД** | Qdrant (dense 1024d + sparse BM25, RRF fusion) |
| **LLM (чат)** | YandexGPT Pro (streaming) |
| **LLM (голос)** | GPT-4o-mini |
| **Embeddings** | OpenAI text-embedding-3-large (1024d) |
| **STT** | gpt-4o-transcribe (Replicate API) |
| **TTS** | OpenAI TTS (tts-1) с DB-кешем |
| **Голосовой транспорт** | LiveKit WebRTC |
| **Python агент** | LiveKit Agents SDK, FastEmbed (ONNX local) |
| **Аутентификация** | JWT HS256, access (15 мин) + refresh (7 дней) |
| **Инфраструктура** | Docker Compose |

---

## Схема данных

### PostgreSQL

| Таблица | Назначение |
|---------|-----------|
| `questions` | 798+ Q&A-пар, очередь скриптования |
| `faqs` | Статические данные клиники (приоритетный контекст RAG) |
| `chat_sessions` / `chat_messages` | История диалогов |
| `tts_caches` | SHA256-кеш синтезированного аудио |
| `articles` | Статьи Legacy Pipeline |
| `transcription_cache` | SHA256-кеш транскрипций звонков |
| `companies` | Мультитенантность |
| `users` | Аутентификация |

### Qdrant

| Коллекция | Векторы | Назначение |
|-----------|---------|-----------|
| `qa_pairs` | dense 1024d + sparse (inverted_index) | Гибридный поиск Q&A (HiTL) |
| `articles` | dense 1024d cosine | Классификация сегментов (Legacy) |

### Гибридный RAG (qa_pairs)

```
Запрос
  ├── OpenAI Embeddings → dense vector (1024d)
  └── BM25 Encoder (vocab 2826 терминов) → sparse vector
        │
        ▼
  Qdrant Prefetch: dense top-20 + sparse top-20
        │
        ▼
  RRF Fusion (k=60) → top-5
        │
        ▼
  Контекст = FAQ (приоритет) + Q&A pairs + прайс (если релевантно)
        │
        ▼
  YandexGPT Pro
```

---

## API

### Публичные

| Метод | Путь | Описание |
|-------|------|---------|
| `POST` | `/api/auth/login` | Вход, получение токенов |
| `POST` | `/api/auth/refresh` | Обновление access-токена |

### Внутренние (Docker network only)

| Метод | Путь | Описание |
|-------|------|---------|
| `POST` | `/api/agent/rag` | Синхронный RAG-запрос (для Pipecat) |
| `POST` | `/api/agent/rag/stream` | Потоковый RAG (SSE) |
| `POST` | `/api/agent/context` | RAG-контекст по slug-ам (для LiveKit агента) |
| `GET`  | `/api/agent/articles` | Все статьи для переиндексации |
| `POST` | `/api/agent/token` | LiveKit JWT-токен |

### Защищённые (Bearer JWT)

| Метод | Путь | Описание |
|-------|------|---------|
| `POST` | `/api/agent/chat` | Потоковый чат (SSE) |
| `POST` | `/api/agent/tts` | TTS с кешем |
| `GET`  | `/api/agent/sessions` | История сессий |
| `GET`  | `/api/questions` | Очередь вопросов |
| `PUT`  | `/api/questions/:id/answer` | Сохранить ответ |
| `POST` | `/api/questions/:id/accept-draft` | Утвердить черновик LLM |
| `POST` | `/api/questions/reindex` | Массовая переиндексация в Qdrant |
| `GET`  | `/api/faq` | Список FAQ |
| `GET`  | `/api/articles` | Список статей |
| `POST` | `/api/pipeline/process` | Обработка аудиофайла |
| `GET`  | `/api/price-tree` | Дерево цен |

---

## Запуск

### Требования

- Docker + Docker Compose
- API-ключи (см. [Переменные окружения](#переменные-окружения))

### Быстрый старт

```bash
# Клонировать репозиторий
git clone <repo-url>
cd servicecraft

# Создать .env из шаблона
cp .env.example .env
# Заполнить API-ключи в .env

# Запустить все сервисы
docker compose up

# Или с горячей перезагрузкой
docker compose watch
```

Сервисы после запуска:

| Сервис | URL |
|--------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8080 |
| Qdrant Dashboard | http://localhost:6333/dashboard |
| LiveKit | ws://localhost:7880 |

Первый запуск автоматически:
- Создаёт все таблицы (GORM AutoMigrate)
- Создаёт superadmin (`ADMIN_EMAIL` / `ADMIN_PASSWORD`)
- Заполняет seed-данные (статьи, FAQ)

### Локальная разработка

```bash
# Backend
cd backend
go run ./cmd/api

# Frontend
cd frontend
npm install
npm run dev   # dev-сервер :3000, прокси /api → :8080

# Voice agent (Python)
cd voice-agent
pip install -e .
python agent.py dev
```

---

## Переменные окружения

| Переменная | Обязательная | Описание |
|------------|:---:|---------|
| `POSTGRES_USER` | — | Пользователь БД (default: `vetkb`) |
| `POSTGRES_PASSWORD` | — | Пароль БД (default: `vetkb_secret`) |
| `POSTGRES_DB` | — | Имя БД (default: `vetkb`) |
| `JWT_SECRET` | ✓ | Секрет для подписи JWT (≥32 символа) |
| `ADMIN_EMAIL` | ✓ | Email superadmin |
| `ADMIN_PASSWORD` | ✓ | Пароль superadmin |
| `OPENAI_API_KEY` | ✓ | OpenAI API (embeddings + TTS + STT) |
| `YANDEX_GPT_API_KEY` | ✓ | YandexGPT API key |
| `YANDEX_GPT_FOLDER_ID` | ✓ | YandexGPT folder ID |
| `YANDEX_GPT_MODEL` | — | Модель (default: `yandexgpt-lite/latest`) |
| `REPLICATE_API_TOKEN` | ✓ | Replicate (gpt-4o-transcribe) |
| `LIVEKIT_API_KEY` | — | LiveKit (default: `devkey`) |
| `LIVEKIT_API_SECRET` | — | LiveKit (default: `devsecret`) |
| `QDRANT_HOST` | — | Хост Qdrant (default: `qdrant`) |
| `QDRANT_PORT` | — | Порт Qdrant (default: `6333`) |

---

## Роли пользователей

| Роль | Доступ |
|------|-------|
| `superadmin` | Всё, включая управление компаниями и пользователями |
| `admin` | Все операции в рамках своей компании, пайплайн |
| `operator` | Чтение, чат с агентом, очередь вопросов |

Мультитенантность: все данные фильтруются по `company_id`. Superadmin видит все компании.
