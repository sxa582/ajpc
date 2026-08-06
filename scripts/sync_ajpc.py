#!/usr/bin/env python3
"""Synchronize eligible CC BY AJPC articles from PMC into the static website."""

from __future__ import annotations

import argparse
import html as html_module
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from import_pmc import fetch_xml, normalize_pmcid, parse_article, write_article, download_assets  # noqa: E402

ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
JOURNAL_QUERY = '"American Journal of Preventive Cardiology"[journal] AND open access[filter]'


def fetch_pmcids(email: str, api_key: str | None, limit: int) -> list[str]:
    params = {
        "db": "pmc",
        "term": JOURNAL_QUERY,
        "retmode": "json",
        "retmax": str(limit),
        "sort": "pub date",
        "tool": "ajpc-native-reader",
        "email": email,
    }
    if api_key:
        params["api_key"] = api_key
    request = urllib.request.Request(
        f"{ESEARCH_URL}?{urllib.parse.urlencode(params)}",
        headers={"User-Agent": f"AJPCNativeReader/1.0 ({email})", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"PMC ESearch returned HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not reach PMC ESearch: {exc.reason}") from exc
    ids = payload.get("esearchresult", {}).get("idlist", [])
    return [normalize_pmcid(value) for value in ids]


def strip_html(value: str) -> str:
    value = re.sub(r"<[^>]+>", " ", value or "")
    return re.sub(r"\s+", " ", html_module.unescape(value)).strip()


def article_summary(article: dict[str, Any], max_chars: int = 360) -> str:
    abstract = article.get("abstract") or []
    text = " ".join(strip_html(item.get("html") or item.get("text") or "") if isinstance(item, dict) else strip_html(str(item)) for item in abstract)
    if not text:
        for section in article.get("sections", []):
            for block in section.get("blocks", []):
                if block.get("type") == "paragraph":
                    text = strip_html(block.get("html") or block.get("text") or "")
                    if text:
                        break
            if text:
                break
    return text if len(text) <= max_chars else text[: max_chars - 1].rstrip() + "…"


def classify_theme(article: dict[str, Any]) -> str:
    text = " ".join([article.get("title", ""), " ".join(article.get("keywords", []))]).lower()
    rules = [
        ("Digital Health & AI", ["artificial intelligence", "machine learning", "digital health", "wearable", "deep learning"]),
        ("Environment & Equity", ["pollution", "environment", "climate", "equity", "disparit", "social determinant"]),
        ("Cardio-Oncology", ["cancer", "oncology", "chemotherapy", "radiotherapy", "androgen deprivation"]),
        ("Hypertension", ["hypertension", "blood pressure"]),
        ("Obesity & Metabolism", ["obesity", "diabetes", "metabolic", "glp-1", "glp1", "weight"]),
        ("Lifestyle & Wellness", ["exercise", "physical activity", "diet", "nutrition", "sleep", "smoking", "lifestyle"]),
        ("Policy & Implementation", ["implementation", "policy", "guideline", "health system", "quality improvement", "cost-effectiveness"]),
        ("Lipids & Atherosclerosis", ["ldl", "lipid", "cholesterol", "atherosclero", "coronary calcium", "plaque", "statin"]),
    ]
    for theme, terms in rules:
        if any(term in text for term in terms):
            return theme
    return "General Prevention"


def index_entry(article: dict[str, Any]) -> dict[str, Any]:
    authors = [author.get("display", "") for author in article.get("authors", []) if author.get("display")]
    if len(authors) > 4:
        authors_short = f"{', '.join(authors[:3])}, et al."
    elif len(authors) > 1:
        authors_short = f"{', '.join(authors[:-1])}, and {authors[-1]}"
    else:
        authors_short = authors[0] if authors else ""
    return {
        "pmcid": article.get("pmcid", ""),
        "pmid": article.get("pmid", ""),
        "doi": article.get("doi", ""),
        "title": article.get("title", ""),
        "authorsShort": authors_short,
        "published": article.get("published", ""),
        "volume": article.get("volume", ""),
        "issue": article.get("issue", ""),
        "articleNumber": article.get("articleNumber", ""),
        "articleType": article.get("articleType", "Article"),
        "theme": classify_theme(article),
        "license": article.get("license", "CC BY"),
        "summary": article_summary(article),
    }


def write_index(entries: list[dict[str, Any]], project_root: Path) -> Path:
    entries.sort(key=lambda item: (item.get("published", ""), item.get("title", "")), reverse=True)
    if entries:
        entries[0]["featured"] = True
    volumes = [int(str(item["volume"])) for item in entries if str(item.get("volume", "")).isdigit()]
    current_volume = str(max(volumes)) if volumes else ""
    current_entries = [entry for entry in entries if not current_volume or str(entry.get("volume", "")) == current_volume]
    theme_order = list(dict.fromkeys(entry.get("theme", "General Prevention") for entry in current_entries))
    payload = {
        "journal": "American Journal of Preventive Cardiology",
        "currentVolume": current_volume,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "themeOrder": theme_order,
        "articles": entries,
    }
    destination = project_root / "data" / "articles.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--email", default=os.environ.get("NCBI_EMAIL", ""), help="Contact email required by NCBI (or set NCBI_EMAIL)")
    parser.add_argument("--api-key", default=os.environ.get("NCBI_API_KEY"), help="Optional NCBI API key")
    parser.add_argument("--limit", type=int, default=1000, help="Maximum PMC records to consider")
    parser.add_argument("--pmcid", action="append", help="Import only a specific PMCID; repeatable")
    parser.add_argument("--download-assets", action="store_true", help="Download figure images into the website")
    parser.add_argument("--keep-going", action="store_true", help="Continue after an unexpected import error")
    args = parser.parse_args()
    if not args.email:
        parser.error("Provide --email or set NCBI_EMAIL before contacting NCBI")

    pmcids = [normalize_pmcid(value) for value in args.pmcid] if args.pmcid else fetch_pmcids(args.email, args.api_key, args.limit)
    print(f"Found {len(pmcids)} PMC records")
    entries: list[dict[str, Any]] = []
    delay = 0.11 if args.api_key else 0.36

    for position, pmcid in enumerate(pmcids, start=1):
        print(f"[{position}/{len(pmcids)}] {pmcid}")
        try:
            xml_bytes = fetch_xml(pmcid, args.email, args.api_key)
            article = parse_article(xml_bytes, pmcid)
            if args.download_assets:
                count = download_assets(article, args.project_root, args.email)
                print(f"  downloaded {count} figures")
            write_article(article, args.project_root)
            entries.append(index_entry(article))
        except PermissionError as exc:
            print(f"  skipped: {exc}")
        except Exception as exc:  # deliberately visible in a batch job
            print(f"  error: {exc}", file=sys.stderr)
            if not args.keep_going:
                raise
        time.sleep(delay)

    destination = write_index(entries, args.project_root)
    print(f"Wrote {len(entries)} CC BY articles to {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
