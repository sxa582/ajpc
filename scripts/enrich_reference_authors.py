#!/usr/bin/env python3
"""Enrich stored AJPC references with complete PubMed author lists."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from import_pmc import enrich_reference_authors, write_article


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--email", required=True)
    parser.add_argument("--api-key")
    parser.add_argument("--current-issue", action="store_true")
    args = parser.parse_args()

    index = json.loads((args.project_root / "data" / "articles.json").read_text(encoding="utf-8"))
    entries = index.get("articles", [])
    if args.current_issue:
        current_volume = str(index.get("currentVolume", ""))
        entries = [entry for entry in entries if str(entry.get("volume", "")) == current_volume]

    for entry in entries:
        path = args.project_root / "data" / "articles" / f"{entry['pmcid']}.json"
        article = json.loads(path.read_text(encoding="utf-8"))
        enrich_reference_authors(article, args.email, args.api_key)
        write_article(article, args.project_root)
        print(f"Enriched {entry['pmcid']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
