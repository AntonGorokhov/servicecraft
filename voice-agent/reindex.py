"""
Re-index all articles in Qdrant with FastEmbed (multilingual-e5-large) embeddings.

Replaces the previous OpenAI text-embedding-3-large vectors with local ONNX embeddings.
Drops and recreates the Qdrant collection, then re-embeds all articles.

Usage:
    python reindex.py                           # local
    docker compose exec voice-agent python reindex.py   # via Docker
"""

import json
import logging
import os
import sys

import requests
from fastembed import TextEmbedding

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("reindex")

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "intfloat/multilingual-e5-large")
QDRANT_URL = os.getenv("QDRANT_URL", "http://qdrant:6333")
BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8080")
COLLECTION_NAME = "articles"
VECTOR_DIM = 1024


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


def main():
    logger.info(f"Loading embedding model: {EMBEDDING_MODEL}")
    model = TextEmbedding(EMBEDDING_MODEL)
    # Warmup
    list(model.embed(["warmup"]))
    logger.info("Model ready")

    # 1. Delete existing collection
    logger.info(f"Deleting collection '{COLLECTION_NAME}'...")
    resp = requests.delete(f"{QDRANT_URL}/collections/{COLLECTION_NAME}")
    logger.info(f"Delete: {resp.status_code}")

    # 2. Create collection with 1024-dim cosine vectors
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

    # 4. Embed and upsert each article
    for i, article in enumerate(articles):
        article_id = article["id"]
        slug = article["slug"]
        name = article["name"]
        category = article.get("category", "")
        company_id = article.get("company_id", 0) or 0

        embed_text = build_embedding_text(name, article.get("content"))

        logger.info(f"[{i + 1}/{len(articles)}] Embedding '{name}'...")
        # multilingual-e5 expects "passage: " prefix for documents
        vectors = list(model.embed([f"passage: {embed_text}"]))
        vec = vectors[0].tolist()

        resp = requests.put(
            f"{QDRANT_URL}/collections/{COLLECTION_NAME}/points",
            json={
                "points": [
                    {
                        "id": article_id,
                        "vector": vec,
                        "payload": {
                            "slug": slug,
                            "name": name,
                            "category": category,
                            "company_id": company_id,
                        },
                    }
                ],
            },
        )
        if resp.status_code != 200:
            logger.error(f"Upsert failed for '{slug}': {resp.text}")
            continue

        logger.info(f"  indexed '{slug}' (dim={len(vec)})")

    logger.info("Re-indexing complete!")


if __name__ == "__main__":
    main()
