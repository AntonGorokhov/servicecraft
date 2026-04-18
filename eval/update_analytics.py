#!/usr/bin/env python3
"""
Reads eval_results.json and patches the hardcoded metric values in AnalyticsPage.tsx.

Usage:
    python update_analytics.py                       # reads eval_results.json
    python update_analytics.py --file my_results.json
"""

import argparse
import json
import re
from pathlib import Path

ANALYTICS_TSX = Path(__file__).parent.parent / "frontend/src/pages/AnalyticsPage.tsx"
RESULTS_FILE = Path(__file__).parent / "eval_results.json"


def patch_analytics(bleu: float, rouge_l: float, bertscore: float, tsx_path: Path):
    source = tsx_path.read_text(encoding="utf-8")

    # Replace the ragMetrics array — matches the block we hardcoded
    pattern = re.compile(
        r'(\{ label: "BLEU",\s*value: )[0-9.]+',
    )
    source = pattern.sub(rf"\g<1>{bleu:.2f}", source)

    pattern = re.compile(r'(\{ label: "ROUGE-L",\s*value: )[0-9.]+')
    source = pattern.sub(rf"\g<1>{rouge_l:.2f}", source)

    pattern = re.compile(r'(\{ label: "BERTScore",\s*value: )[0-9.]+')
    source = pattern.sub(rf"\g<1>{bertscore:.2f}", source)

    tsx_path.write_text(source, encoding="utf-8")
    print(f"Patched {tsx_path}")
    print(f"  BLEU-4:    {bleu:.2f}")
    print(f"  ROUGE-L:   {rouge_l:.2f}")
    print(f"  BERTScore: {bertscore:.2f}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", type=Path, default=RESULTS_FILE)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.file.exists():
        print(f"Results file not found: {args.file}")
        print("Run eval_rag.py first.")
        raise SystemExit(1)

    with open(args.file, encoding="utf-8") as f:
        data = json.load(f)

    m = data["metrics"]
    bleu = m["bleu4"]
    rouge_l = m["rouge_l"]
    bertscore = m["bertscore"]

    print(f"Results from {args.file}:")
    print(f"  BLEU-4:    {bleu}")
    print(f"  ROUGE-L:   {rouge_l}")
    print(f"  BERTScore: {bertscore}")

    if args.dry_run:
        print("\n[dry-run] No files modified.")
        return

    if not ANALYTICS_TSX.exists():
        print(f"Not found: {ANALYTICS_TSX}")
        raise SystemExit(1)

    patch_analytics(bleu, rouge_l, bertscore, ANALYTICS_TSX)


if __name__ == "__main__":
    main()
