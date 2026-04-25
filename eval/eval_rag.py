#!/usr/bin/env python3
"""
RAG evaluation: BLEU-4, ROUGE-L, BERTScore against 123 scripted Q&A pairs.

Usage:
    python eval_rag.py                      # run full evaluation
    python eval_rag.py --dry-run            # print questions without calling agent
    python eval_rag.py --resume             # skip already-evaluated pairs from cache
    python eval_rag.py --limit 20           # evaluate first N questions only

Output:
    eval_results.json  — per-question pairs + aggregate metrics
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import psycopg2
import requests
from tqdm import tqdm

# ---------------------------------------------------------------------------
# Config (override via env vars)
# ---------------------------------------------------------------------------
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8080")
DB_DSN = os.getenv(
    "DB_DSN",
    "postgresql://vetkb:vetkb_secret@localhost:5432/vetkb",
)
# Delay between RAG calls — YandexGPT has rate limits (~5 rps)
REQUEST_DELAY = float(os.getenv("REQUEST_DELAY", "1.5"))
RESULTS_FILE = Path("eval_results.json")

# BERTScore model — multilingual-bert gives stable ~0.81 on Russian semantic pairs
BERTSCORE_MODEL = os.getenv("BERTSCORE_MODEL", "bert-base-multilingual-cased")


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_scripted_questions():
    conn = psycopg2.connect(DB_DSN)
    cur = conn.cursor()
    cur.execute("""
        SELECT id, question, answer, company_id
        FROM questions
        WHERE answer != '' AND answer IS NOT NULL
        ORDER BY frequency DESC
    """)
    rows = cur.fetchall()
    conn.close()
    return [
        {"id": r[0], "question": r[1], "answer": r[2], "company_id": r[3]}
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Agent call
# ---------------------------------------------------------------------------

def query_agent(question: str, company_id) -> str:
    payload: dict = {"text": question, "session_id": 0}
    if company_id is not None:
        payload["company_id"] = int(company_id)

    resp = requests.post(
        f"{BACKEND_URL}/api/agent/rag",
        json=payload,
        timeout=45,
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("response", "")


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

def clean_ref(text: str) -> str:
    """Strip operator meta-instructions in parentheses from reference answers."""
    import re
    # Remove parenthetical notes like (Смотрим систему записи...) and (ждём ответ)
    text = re.sub(r'\([^)]{10,}\)', '', text)
    return text.strip()


def compute_bleu(hypotheses: list[str], references: list[str]) -> float:
    from sacrebleu.metrics import BLEU

    # tokenize='none' uses whitespace — works for Russian word-level BLEU
    bleu = BLEU(tokenize="none", lowercase=True)
    result = bleu.corpus_score(hypotheses, [references])
    return result.score / 100.0  # sacrebleu returns 0–100


def compute_chrf(hypotheses: list[str], references: list[str]) -> float:
    """chrF — character n-gram F-score, more suitable for morphologically rich Russian."""
    from sacrebleu.metrics import CHRF
    chrf = CHRF()
    result = chrf.corpus_score(hypotheses, [references])
    return result.score / 100.0


def compute_rouge_l(hypotheses: list[str], references: list[str]) -> float:
    from rouge_score import rouge_scorer

    scorer = rouge_scorer.RougeScorer(["rougeL"], use_stemmer=False)
    scores = [
        scorer.score(ref, hyp)["rougeL"].fmeasure
        for ref, hyp in zip(references, hypotheses)
    ]
    return sum(scores) / len(scores)


def compute_bertscore(hypotheses: list[str], references: list[str]) -> float:
    from bert_score import score

    print(f"  Computing BERTScore with {BERTSCORE_MODEL} (first run downloads ~400MB)...")
    _, _, F1 = score(
        hypotheses,
        references,
        model_type=BERTSCORE_MODEL,
        lang="ru",
        verbose=False,
        batch_size=16,
    )
    return F1.mean().item()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--resume", action="store_true", help="skip already done pairs")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    print("Loading scripted questions from DB...")
    questions = load_scripted_questions()
    print(f"  Found {len(questions)} scripted Q&A pairs")

    if args.limit:
        questions = questions[: args.limit]
        print(f"  Limited to {args.limit} questions")

    if args.dry_run:
        for q in questions:
            print(f"  [{q['id']}] {q['question'][:80]}")
        return

    # Load existing results for --resume
    completed: dict[int, dict] = {}
    if args.resume and RESULTS_FILE.exists():
        with open(RESULTS_FILE, encoding="utf-8") as f:
            prev = json.load(f)
        for pair in prev.get("pairs", []):
            completed[pair["id"]] = pair
        print(f"  Resuming: {len(completed)} pairs already done")

    pairs = []
    failed = []

    for q in tqdm(questions, desc="Querying agent"):
        qid = q["id"]

        if qid in completed:
            pairs.append(completed[qid])
            continue

        try:
            response = query_agent(q["question"], q["company_id"])
            pairs.append({
                "id": qid,
                "question": q["question"],
                "reference": q["answer"],
                "hypothesis": response,
            })
        except Exception as e:
            tqdm.write(f"  ✗ [{qid}] {q['question'][:50]}: {e}")
            failed.append(qid)

        time.sleep(REQUEST_DELAY)

    if not pairs:
        print("No successful responses — aborting.")
        sys.exit(1)

    refs = [p["reference"] for p in pairs]
    refs_clean = [clean_ref(r) for r in refs]
    hyps = [p["hypothesis"] for p in pairs]

    print(f"\nComputing metrics on {len(pairs)} pairs ({len(failed)} failed)...")

    bleu = compute_bleu(hyps, refs_clean)
    print(f"  BLEU-4:    {bleu:.3f}")

    chrf = compute_chrf(hyps, refs_clean)
    print(f"  chrF:      {chrf:.3f}")

    rouge_l = compute_rouge_l(hyps, refs_clean)
    print(f"  ROUGE-L:   {rouge_l:.3f}")

    bertscore = compute_bertscore(hyps, refs_clean)
    print(f"  BERTScore: {bertscore:.3f}")

    print(f"\n{'─'*40}")
    print(f"  BLEU-4:     {bleu:.2f}  (target 0.41)")
    print(f"  chrF:       {chrf:.2f}")
    print(f"  ROUGE-L:    {rouge_l:.2f}  (target 0.58)")
    print(f"  BERTScore:  {bertscore:.2f}  (target 0.81)")
    print(f"{'─'*40}")

    output = {
        "n_evaluated": len(pairs),
        "n_failed": len(failed),
        "failed_ids": failed,
        "metrics": {
            "bleu4": round(bleu, 3),
            "chrf": round(chrf, 3),
            "rouge_l": round(rouge_l, 3),
            "bertscore": round(bertscore, 3),
        },
        "config": {
            "backend_url": BACKEND_URL,
            "bertscore_model": BERTSCORE_MODEL,
            "request_delay": REQUEST_DELAY,
        },
        "pairs": pairs,
    }

    with open(RESULTS_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nResults saved to {RESULTS_FILE}")


if __name__ == "__main__":
    main()
