"""
Re-index all articles in Qdrant with OpenAI text-embedding-3-small embeddings.

Usage:
    docker compose exec voice-agent python reindex.py
"""

import json
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("reindex")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
QDRANT_URL = os.getenv("QDRANT_URL", "http://qdrant:6333")
BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8080")
COLLECTION_NAME = "articles"
VECTOR_DIM = 1536  # text-embedding-3-small


def build_embedding_text(name: str, content) -> str:
    """Build text for embedding from article name + trigger phrases."""
    parts = [name]

    obj = None
    if isinstance(content, dict):
        obj = content
    elif isinstance(content, str):
        try:
            obj = json.loads(content)
        except (json.JSONDecodeError, TypeError):
            pass

    if isinstance(obj, dict):
        phrases = obj.get("trigger_phrases", [])
        if isinstance(phrases, list):
            for p in phrases:
                if isinstance(p, str):
                    parts.append(p)

    return ". ".join(parts)


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts via OpenAI API."""
    resp = requests.post(
        "https://api.openai.com/v1/embeddings",
        json={"input": texts, "model": EMBEDDING_MODEL},
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
        timeout=30,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"OpenAI embedding error {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    return [item["embedding"] for item in data["data"]]


def main():
    if not OPENAI_API_KEY:
        logger.error("OPENAI_API_KEY is required")
        sys.exit(1)

    logger.info(f"Using embedding model: {EMBEDDING_MODEL} (dim={VECTOR_DIM})")

    # 1. Delete existing collection
    logger.info(f"Deleting collection '{COLLECTION_NAME}'...")
    resp = requests.delete(f"{QDRANT_URL}/collections/{COLLECTION_NAME}")
    logger.info(f"Delete: {resp.status_code}")

    # 2. Create collection
    logger.info(f"Creating collection '{COLLECTION_NAME}' (dim={VECTOR_DIM}, cosine)...")
    resp = requests.put(
        f"{QDRANT_URL}/collections/{COLLECTION_NAME}",
        json={"vectors": {"size": VECTOR_DIM, "distance": "Cosine"}},
    )
    if resp.status_code != 200:
        logger.error(f"Create collection failed: {resp.text}")
        sys.exit(1)
    logger.info("Collection created")

    # 3. Fetch all articles from backend
    logger.info("Fetching articles from backend...")
    resp = requests.get(f"{BACKEND_URL}/api/agent/articles")
    if resp.status_code != 200:
        logger.error(f"Fetch articles failed {resp.status_code}: {resp.text}")
        sys.exit(1)
    articles = resp.json()
    logger.info(f"Got {len(articles)} articles")

    if not articles:
        logger.info("No articles to index")
        return

    # 4. Batch embed all articles
    texts = []
    for article in articles:
        embed_text = build_embedding_text(article["name"], article.get("content"))
        texts.append(embed_text)

    logger.info(f"Embedding {len(texts)} articles via OpenAI API...")
    t0 = time.time()
    vectors = embed_texts(texts)
    logger.info(f"Embedded in {time.time() - t0:.1f}s")

    # 5. Upsert all points
    points = []
    for article, vec in zip(articles, vectors):
        points.append({
            "id": article["id"],
            "vector": vec,
            "payload": {
                "slug": article["slug"],
                "name": article["name"],
                "category": article.get("category", ""),
                "company_id": article.get("company_id", 0) or 0,
            },
        })

    resp = requests.put(
        f"{QDRANT_URL}/collections/{COLLECTION_NAME}/points",
        json={"points": points},
    )
    if resp.status_code != 200:
        logger.error(f"Upsert failed: {resp.text}")
        sys.exit(1)

    logger.info(f"Indexed {len(points)} articles (dim={len(vectors[0])})")
    logger.info("Re-indexing complete!")


if __name__ == "__main__":
    main()
