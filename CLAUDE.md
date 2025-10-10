# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ServiceCraft (VetKB) — a multi-tenant veterinary clinic call-center knowledge base. It processes phone call audio through an AI pipeline (transcription → segmentation → classification → KB enrichment) and stores structured knowledge articles. Russian-language content.

## Development Commands

### Full Stack (Docker Compose)

```bash
docker compose up              # Start all: Postgres, backend, frontend, Qdrant
docker compose watch           # Start with hot-reload
docker compose up --build      # Rebuild and start
```

Services: `postgres` (:5432), `backend` (:8080), `frontend` (:3000), `qdrant` (:6333/:6334)

### Backend (Go)

```bash
cd backend
go run ./cmd/api               # Run locally (needs Postgres + Qdrant)
go build -o api ./cmd/api      # Build binary
go mod tidy                    # Tidy dependencies
```

### Frontend (React/Vite)

```bash
cd frontend
npm install                    # Install deps
npm run dev                    # Dev server on :3000 (proxies /api → :8080)
npm run build                  # Type-check + production build
```

### Testing

No test suite exists yet. No linting configs are configured.

## Architecture

**Monorepo:** `backend/` (Go) + `frontend/` (React/TypeScript)

### Backend — Go 1.24, Gin, GORM + PostgreSQL

- `cmd/api/main.go` — entry point, route wiring, dependency injection
- `internal/config/` — env-based config (no config files)
- `internal/database/` — GORM PostgreSQL connection + AutoMigrate
- `internal/models/` — GORM structs (User, Company, Article) + seed data
- `internal/services/` — business logic (AuthService, ArticleService, CompanyService)
- `internal/handlers/` — HTTP handlers, thin layer calling services
- `internal/middleware/` — CORS, JWT auth (`AuthRequired`), role checks (`SuperadminRequired`)
- `internal/pipeline/` — AI pipeline orchestration (Replicate API, Qdrant, LLM prompts)

### Frontend — React 19, TypeScript strict, Vite 6, Tailwind CSS v4

- `src/api/client.ts` — Axios with JWT access/refresh token interceptor
- `src/context/AuthContext.tsx` + `src/hooks/useAuth.ts` — auth state via React Context
- `src/pages/` — route-level components (PipelinePage is the largest/most complex)
- `src/components/` — shared UI (Sidebar, Layout, Modals, ProtectedRoute)
- Tailwind v4 uses `@import "tailwindcss"` with `@theme` CSS variables in `main.css`

### Database

Schema managed by GORM AutoMigrate (runs on startup). AutoMigrate only adds columns/tables, never drops — be careful with destructive schema changes.

Tables: `companies`, `users`, `articles` (with JSONB `content` and `embedding` fields).

### Qdrant Vector DB

REST API (not gRPC). Collection: `articles`, dimension: 1024 (Qwen3 embeddings), cosine distance. Company isolation via `company_id` payload filter.

The Article `embedding` JSONB field stores `{"indexed": true}` as a marker — actual vectors live in Qdrant.

## Key Patterns

- **Multi-tenancy:** All queries filter by `company_id`. Superadmin (`company_id = NULL`) sees all.
- **Auth:** JWT HS256 with access (15min) + refresh (7d) tokens. `token_type` claim distinguishes them.
- **Roles:** `superadmin` (global), `admin` (company-scoped, can run pipeline), `operator` (read-only)
- **Pipeline:** `POST /api/pipeline/process` (multipart audio). Segment processing uses a mutex to prevent race conditions. Replicate API calls use `Prefer: wait` header with polling fallback.
- **Vite proxy:** `/api/*` → `http://127.0.0.1:8080`

## Environment

Copy `.env.example` to `.env`. Required vars: `POSTGRES_*`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `QDRANT_HOST`, `QDRANT_PORT`, `REPLICATE_API_TOKEN`. All have local-dev defaults in `backend/internal/config/config.go`.
