"""
RAG service: OpenAI embeddings → Qdrant (direct REST) → Backend (articles/prices).

Embedding: OpenAI text-embedding-3-small (1536-dim, API ~50ms)
Vector search: Qdrant REST API (direct, no Go backend roundtrip)
Article content + price match: Go backend /api/agent/context
"""

import logging
import os
from dataclasses import dataclass, field

import aiohttp

logger = logging.getLogger("voice-agent.rag")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
QDRANT_URL = os.getenv("QDRANT_URL", "http://qdrant:6333")
BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8080")
DEFAULT_COMPANY_ID = int(os.getenv("DEFAULT_COMPANY_ID", "1"))
COLLECTION_NAME = "articles"
RAG_TOP_K = 5
RAG_THRESHOLD = 0.3


@dataclass
class RAGResult:
    context: str = ""
    sources: list = field(default_factory=list)
    price_info: str = ""


class RAGService:
    def __init__(self):
        self._http: aiohttp.ClientSession | None = None

    async def initialize(self):
        """Create HTTP session. No model to load — embeddings via OpenAI API."""
        self._http = aiohttp.ClientSession()
        logger.info(f"RAG service ready (embedding: {EMBEDDING_MODEL} via API)")

    async def close(self):
        if self._http:
            await self._http.close()

    async def embed(self, text: str) -> list[float]:
        """Embed a query via OpenAI API (~50ms)."""
        async with self._http.post(
            "https://api.openai.com/v1/embeddings",
            json={"input": text, "model": EMBEDDING_MODEL},
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            timeout=aiohttp.ClientTimeout(total=5),
        ) as resp:
            if resp.status != 200:
                body = await resp.text()
                raise RuntimeError(f"OpenAI embedding error {resp.status}: {body[:200]}")
            data = await resp.json()
            return data["data"][0]["embedding"]

    async def search(self, query: str) -> RAGResult:
        """Full RAG pipeline: embed → Qdrant → fetch articles from backend."""
        result = RAGResult()

        try:
            # 1. Embed via API (~50ms)
            vec = await self.embed(query)

            # 2. Search Qdrant directly (~50ms)
            matches = await self._qdrant_search(vec, DEFAULT_COMPANY_ID)
            if not matches:
                return result

            result.sources = [
                {
                    "slug": m["slug"],
                    "name": m["name"],
                    "category": m["category"],
                    "score": m["score"],
                }
                for m in matches
            ]

            # 3. Fetch article content + price match from backend (~20ms)
            slugs = [m["slug"] for m in matches[:3]]
            ctx_result = await self._fetch_context(slugs, query)
            result.context = ctx_result.get("context", "")
            result.price_info = ctx_result.get("price_info", "")

        except Exception as e:
            logger.error(f"RAG search failed: {e}")

        return result

    async def _qdrant_search(self, vector: list[float], company_id: int) -> list[dict]:
        """Search Qdrant collection for similar articles."""
        payload = {
            "query": vector,
            "limit": RAG_TOP_K,
            "score_threshold": RAG_THRESHOLD,
            "with_payload": True,
        }
        if company_id:
            payload["filter"] = {
                "should": [
                    {"key": "company_id", "match": {"value": company_id}},
                    {"key": "company_id", "match": {"value": 0}},
                ],
            }

        try:
            async with self._http.post(
                f"{QDRANT_URL}/collections/{COLLECTION_NAME}/points/query",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=2),
            ) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    logger.error(f"Qdrant search error {resp.status}: {body[:200]}")
                    return []
                data = await resp.json()
                points = data.get("result", {}).get("points", [])
                return [
                    {
                        "slug": p["payload"].get("slug", ""),
                        "name": p["payload"].get("name", ""),
                        "category": p["payload"].get("category", ""),
                        "score": p.get("score", 0),
                    }
                    for p in points
                ]
        except Exception as e:
            logger.error(f"Qdrant search failed: {e}")
            return []

    async def _fetch_context(self, slugs: list[str], query: str) -> dict:
        """Fetch formatted article content + price match from Go backend."""
        payload = {
            "slugs": slugs,
            "query": query,
            "company_id": DEFAULT_COMPANY_ID,
        }

        try:
            async with self._http.post(
                f"{BACKEND_URL}/api/agent/context",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=2),
            ) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    logger.error(f"Backend context error {resp.status}: {body[:200]}")
                    return {}
                return await resp.json()
        except Exception as e:
            logger.error(f"Backend context fetch failed: {e}")
            return {}
