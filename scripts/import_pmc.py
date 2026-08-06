#!/usr/bin/env python3
"""Import one CC BY article from PMC EFetch into the AJPC static reader.

Uses only Python's standard library. The generated JSON is consumed by article.html.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Iterable

XLINK = "{http://www.w3.org/1999/xlink}href"
EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
ALLOWED_INLINE = {
    "bold": "strong",
    "italic": "em",
    "sub": "sub",
    "sup": "sup",
    "underline": "span",
    "monospace": "span",
}


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def clean_space(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def plain_text(node: ET.Element | None) -> str:
    return clean_space("".join(node.itertext())) if node is not None else ""


def inline_html(node: ET.Element | None) -> str:
    if node is None:
        return ""

    def render(current: ET.Element) -> str:
        output = html.escape(current.text or "")
        for child in list(current):
            tag = local_name(child.tag)
            body = render(child)
            if tag in ALLOWED_INLINE:
                mapped = ALLOWED_INLINE[tag]
                class_attr = ' class="underline"' if tag == "underline" else (' class="monospace"' if tag == "monospace" else "")
                output += f"<{mapped}{class_attr}>{body}</{mapped}>"
            elif tag == "ext-link":
                href = child.get(XLINK) or child.get("href") or ""
                if href.startswith(("http://", "https://")):
                    output += f'<a href="{html.escape(href, quote=True)}">{body}</a>'
                else:
                    output += body
            elif tag == "email":
                address = plain_text(child)
                output += f'<a href="mailto:{html.escape(address, quote=True)}">{body}</a>' if address else body
            elif tag in {"xref", "named-content", "sc", "styled-content", "inline-formula", "tex-math"}:
                output += body
            else:
                output += body
            output += html.escape(child.tail or "")
        return output

    return clean_space(render(node))


def first(root: ET.Element, name: str) -> ET.Element | None:
    return root.find(f".//{{*}}{name}")


def all_nodes(root: ET.Element, name: str) -> list[ET.Element]:
    return root.findall(f".//{{*}}{name}")


def normalize_pmcid(value: str) -> str:
    value = value.strip().upper()
    if value.startswith("PMC"):
        value = value[3:]
    if not value.isdigit():
        raise ValueError(f"Invalid PMCID: {value!r}")
    return f"PMC{value}"


def fetch_xml(pmcid: str, email: str, api_key: str | None = None, timeout: int = 45) -> bytes:
    params = {
        "db": "pmc",
        "id": pmcid,
        "retmode": "xml",
        "tool": "ajpc-native-reader",
        "email": email,
    }
    if api_key:
        params["api_key"] = api_key
    url = f"{EFETCH_URL}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": f"AJPCNativeReader/1.0 ({email})",
            "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"PMC EFetch returned HTTP {exc.code} for {pmcid}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not reach PMC EFetch for {pmcid}: {exc.reason}") from exc


def article_element(root: ET.Element) -> ET.Element:
    if local_name(root.tag) == "article":
        return root
    article = root.find(".//{*}article")
    if article is None:
        raise ValueError("The EFetch response does not contain a JATS <article> element")
    return article


def extract_ids(article: ET.Element) -> dict[str, str]:
    ids: dict[str, str] = {}
    aliases = {"pmc": "pmcid", "pmcaid": "pmcid", "pmcid-ver": "pmcid_ver", "publisher-id": "publisher_id"}
    for node in all_nodes(article, "article-id"):
        kind = (node.get("pub-id-type") or "").lower()
        key = aliases.get(kind, kind)
        value = plain_text(node)
        if key and value:
            ids[key] = value
    if ids.get("pmcid") and not ids["pmcid"].upper().startswith("PMC"):
        ids["pmcid"] = f"PMC{ids['pmcid']}"
    return ids


def extract_license(article: ET.Element) -> dict[str, str]:
    license_nodes = all_nodes(article, "license")
    text = clean_space(" ".join(plain_text(node) for node in license_nodes))
    urls: list[str] = []
    for node in license_nodes:
        for link in node.iter():
            href = link.get(XLINK) or link.get("href")
            if href:
                urls.append(href)
    normalized_urls = [url.lower().rstrip("/") + "/" for url in urls]
    strict_cc_by = next((url for url in normalized_urls if re.search(r"creativecommons\.org/licenses/by/\d(?:\.\d)?/$", url)), "")
    text_lower = text.lower()
    text_cc_by = (
        "creative commons attribution" in text_lower
        and "noncommercial" not in text_lower
        and "no derivatives" not in text_lower
        and "noderivatives" not in text_lower
        and "sharealike" not in text_lower
    )
    if not strict_cc_by and not text_cc_by:
        raise PermissionError(
            "This importer is configured for strict CC BY articles. "
            f"Detected license text: {text[:220] or 'not found'}"
        )
    license_url = strict_cc_by or next((url for url in urls if "creativecommons.org/licenses/by/" in url.lower()), "https://creativecommons.org/licenses/by/4.0/")
    version_match = re.search(r"licenses/by/(\d(?:\.\d)?)", license_url, re.I)
    version = version_match.group(1) if version_match else "4.0"
    return {"name": f"CC BY {version}", "url": license_url, "text": text}


def extract_authors(article: ET.Element) -> list[dict[str, str]]:
    authors: list[dict[str, str]] = []
    contrib_group = article.find(".//{*}article-meta/{*}contrib-group")
    if contrib_group is None:
        contrib_group = first(article, "contrib-group")
    if contrib_group is None:
        return authors
    for contrib in contrib_group.findall("./{*}contrib"):
        if (contrib.get("contrib-type") or "author") != "author":
            continue
        name = contrib.find("./{*}name")
        collab = contrib.find("./{*}collab")
        if name is not None:
            surname = plain_text(name.find("./{*}surname"))
            given = plain_text(name.find("./{*}given-names"))
            suffix = plain_text(name.find("./{*}suffix"))
            display = clean_space(" ".join(part for part in [given, surname, suffix] if part))
        else:
            display = plain_text(collab)
            surname = display
            given = ""
        if display:
            authors.append({"given": given, "surname": surname, "display": display})
    return authors


def extract_affiliations(article: ET.Element) -> list[str]:
    return [plain_text(node) for node in all_nodes(article, "aff") if plain_text(node)]


def extract_date(article: ET.Element) -> str:
    candidates = article.findall(".//{*}article-meta/{*}pub-date")
    preferred = sorted(candidates, key=lambda n: 0 if (n.get("pub-type") or n.get("date-type")) in {"epub", "electronic", "pub"} else 1)
    for node in preferred:
        year = plain_text(node.find("./{*}year"))
        month = plain_text(node.find("./{*}month")) or "1"
        day = plain_text(node.find("./{*}day")) or "1"
        if year.isdigit():
            try:
                return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"
            except ValueError:
                return year
    return ""


def parse_list(node: ET.Element) -> dict[str, Any]:
    ordered = (node.get("list-type") or "").lower() in {"order", "ordered", "number", "roman-lower", "roman-upper", "alpha-lower", "alpha-upper"}
    items = []
    for item in node.findall("./{*}list-item"):
        item_html = " ".join(inline_html(p) for p in item.findall("./{*}p")) or inline_html(item)
        if item_html:
            items.append(item_html)
    return {"type": "list", "ordered": ordered, "items": items}


def graphic_source(fig: ET.Element, pmcid: str) -> str:
    graphic = fig.find(".//{*}graphic")
    if graphic is None:
        graphic = fig.find(".//{*}inline-graphic")
    if graphic is None:
        return ""
    href = graphic.get(XLINK) or graphic.get("href") or ""
    if not href:
        return ""
    if href.startswith(("http://", "https://", "/")):
        return href
    return f"https://pmc.ncbi.nlm.nih.gov/articles/{pmcid}/bin/{urllib.parse.quote(href)}"


def table_html(table_wrap: ET.Element) -> str:
    table = table_wrap.find(".//{*}table")
    if table is None:
        return ""
    rows: list[str] = []
    for row in table.findall(".//{*}tr"):
        cells: list[str] = []
        for cell in list(row):
            tag = local_name(cell.tag)
            if tag not in {"td", "th"}:
                continue
            safe_tag = tag
            colspan = cell.get("colspan")
            rowspan = cell.get("rowspan")
            attrs = ""
            if colspan and colspan.isdigit():
                attrs += f' colspan="{colspan}"'
            if rowspan and rowspan.isdigit():
                attrs += f' rowspan="{rowspan}"'
            cells.append(f"<{safe_tag}{attrs}>{inline_html(cell)}</{safe_tag}>")
        if cells:
            rows.append(f"<tr>{''.join(cells)}</tr>")
    return f"<table>{''.join(rows)}</table>" if rows else ""


def parse_direct_blocks(container: ET.Element, pmcid: str) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    for child in list(container):
        tag = local_name(child.tag)
        if tag in {"title", "label", "sec"}:
            continue
        if tag == "p":
            value = inline_html(child)
            if value:
                blocks.append({"type": "paragraph", "html": value})
        elif tag == "list":
            parsed = parse_list(child)
            if parsed["items"]:
                blocks.append(parsed)
        elif tag == "fig":
            label = plain_text(child.find("./{*}label"))
            caption_node = child.find("./{*}caption")
            caption = " ".join(inline_html(p) for p in caption_node.findall("./{*}p")) if caption_node is not None else ""
            blocks.append({
                "type": "figure",
                "label": label,
                "caption": caption,
                "src": graphic_source(child, pmcid),
                "alt": clean_space(f"{label} {plain_text(caption_node)}"),
            })
        elif tag == "table-wrap":
            label = plain_text(child.find("./{*}label"))
            caption_node = child.find("./{*}caption")
            caption = " ".join(inline_html(p) for p in caption_node.findall("./{*}p")) if caption_node is not None else ""
            blocks.append({"type": "table", "label": label, "caption": caption, "html": table_html(child)})
        elif tag in {"disp-quote", "boxed-text", "verse-group"}:
            value = inline_html(child)
            if value:
                blocks.append({"type": "quote", "html": value})
        elif tag in {"def-list", "alternatives", "supplementary-material", "media"}:
            value = plain_text(child)
            if value:
                blocks.append({"type": "paragraph", "text": value})
    return blocks


def parse_sections(article: ET.Element, pmcid: str) -> list[dict[str, Any]]:
    body = article.find(".//{*}body")
    if body is None:
        return []
    sections: list[dict[str, Any]] = []

    def walk(sec: ET.Element, level: int = 1) -> None:
        title = plain_text(sec.find("./{*}title")) or "Untitled section"
        blocks = parse_direct_blocks(sec, pmcid)
        sections.append({"title": title, "level": level, "blocks": blocks})
        for nested in sec.findall("./{*}sec"):
            walk(nested, level + 1)

    top_sections = body.findall("./{*}sec")
    if top_sections:
        for section in top_sections:
            walk(section)
    else:
        blocks = parse_direct_blocks(body, pmcid)
        if blocks:
            sections.append({"title": "Article", "level": 1, "blocks": blocks})
    return sections


def extract_abstract(article: ET.Element) -> list[dict[str, str]]:
    abstract = article.find(".//{*}article-meta/{*}abstract")
    if abstract is None:
        abstract = first(article, "abstract")
    if abstract is None:
        return []
    items: list[dict[str, str]] = []
    for child in list(abstract):
        tag = local_name(child.tag)
        if tag == "title":
            continue
        if tag == "p":
            items.append({"html": inline_html(child)})
        elif tag == "sec":
            title = plain_text(child.find("./{*}title"))
            for paragraph in child.findall("./{*}p"):
                prefix = f"<strong>{html.escape(title)}:</strong> " if title else ""
                items.append({"html": prefix + inline_html(paragraph)})
    if not items and plain_text(abstract):
        items.append({"text": plain_text(abstract)})
    return items


def extract_references(article: ET.Element) -> list[dict[str, str]]:
    references: list[dict[str, str]] = []
    for ref in all_nodes(article, "ref"):
        citation = ref.find("./{*}mixed-citation")
        if citation is None:
            citation = ref.find("./{*}element-citation")
        if citation is None:
            citation = ref.find("./{*}nlm-citation")
        if citation is None:
            citation = ref
        value = inline_html(citation)
        if value:
            references.append({"html": value})
    return references


def extract_keywords(article: ET.Element) -> list[str]:
    values = [plain_text(node) for node in all_nodes(article, "kwd")]
    return list(dict.fromkeys(value for value in values if value))


def extract_copyright(article: ET.Element) -> str:
    holder = plain_text(first(article, "copyright-holder"))
    year = plain_text(first(article, "copyright-year"))
    return clean_space(" ".join(part for part in [year, holder] if part)) or "The Authors"


def parse_article(xml_bytes: bytes, requested_pmcid: str) -> dict[str, Any]:
    root = ET.fromstring(xml_bytes)
    article = article_element(root)
    ids = extract_ids(article)
    pmcid = normalize_pmcid(ids.get("pmcid") or requested_pmcid)
    license_info = extract_license(article)
    title_node = article.find(".//{*}article-meta/{*}title-group/{*}article-title")
    if title_node is None:
        title_node = first(article, "article-title")
    journal_node = article.find(".//{*}journal-meta/{*}journal-title-group/{*}journal-title")
    if journal_node is None:
        journal_node = first(article, "journal-title")
    article_type = (article.get("article-type") or "article").replace("-", " ").title()
    published = extract_date(article)
    volume = plain_text(article.find(".//{*}article-meta/{*}volume"))
    issue = plain_text(article.find(".//{*}article-meta/{*}issue"))
    fpage = plain_text(article.find(".//{*}article-meta/{*}fpage"))
    elocation = plain_text(article.find(".//{*}article-meta/{*}elocation-id"))
    article_number = elocation or ids.get("publisher_id") or fpage
    doi = ids.get("doi", "")
    return {
        "pmcid": pmcid,
        "pmid": ids.get("pmid", ""),
        "doi": doi,
        "pmcUrl": f"https://pmc.ncbi.nlm.nih.gov/articles/{pmcid}/",
        "journal": plain_text(journal_node) or "American Journal of Preventive Cardiology",
        "title": plain_text(title_node),
        "articleType": article_type,
        "published": published,
        "year": published[:4] if published else "",
        "volume": volume,
        "issue": issue,
        "articleNumber": article_number,
        "license": license_info["name"],
        "licenseUrl": license_info["url"],
        "licenseText": license_info["text"],
        "copyright": extract_copyright(article),
        "authors": extract_authors(article),
        "affiliations": extract_affiliations(article),
        "keywords": extract_keywords(article),
        "abstract": extract_abstract(article),
        "sections": parse_sections(article, pmcid),
        "references": extract_references(article),
        "source": "PMC EFetch JATS XML",
    }


def download_assets(article: dict[str, Any], project_root: Path, email: str) -> int:
    target_dir = project_root / "assets" / "pmc" / article["pmcid"]
    target_dir.mkdir(parents=True, exist_ok=True)
    downloaded = 0
    for section in article.get("sections", []):
        for block in section.get("blocks", []):
            if block.get("type") != "figure" or not block.get("src", "").startswith("https://"):
                continue
            source = block["src"]
            filename = Path(urllib.parse.urlparse(source).path).name or f"figure-{downloaded + 1}.jpg"
            filename = re.sub(r"[^A-Za-z0-9._-]", "_", filename)
            destination = target_dir / filename
            request = urllib.request.Request(source, headers={"User-Agent": f"AJPCNativeReader/1.0 ({email})"})
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    destination.write_bytes(response.read())
                block["src"] = f"assets/pmc/{article['pmcid']}/{filename}"
                downloaded += 1
            except (urllib.error.URLError, urllib.error.HTTPError) as exc:
                print(f"Warning: could not download {source}: {exc}", file=sys.stderr)
    return downloaded


def write_article(article: dict[str, Any], project_root: Path) -> Path:
    destination = project_root / "data" / "articles" / f"{article['pmcid']}.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(article, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pmcid", help="PMC identifier, e.g. PMC13330701")
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--email", default=os.environ.get("NCBI_EMAIL", ""), help="Contact email required by NCBI (or set NCBI_EMAIL)")
    parser.add_argument("--api-key", default=os.environ.get("NCBI_API_KEY"), help="Optional NCBI API key")
    parser.add_argument("--download-assets", action="store_true", help="Download figure images into the project")
    parser.add_argument("--xml-file", type=Path, help="Parse a local JATS XML file instead of contacting PMC")
    args = parser.parse_args()
    if not args.email and not args.xml_file:
        parser.error("Provide --email or set NCBI_EMAIL before contacting NCBI")
    if not args.email:
        args.email = "local-jats-import@example.invalid"
    pmcid = normalize_pmcid(args.pmcid)
    xml_bytes = args.xml_file.read_bytes() if args.xml_file else fetch_xml(pmcid, args.email, args.api_key)
    article = parse_article(xml_bytes, pmcid)
    if args.download_assets:
        count = download_assets(article, args.project_root, args.email)
        print(f"Downloaded {count} figure assets")
    destination = write_article(article, args.project_root)
    print(f"Imported {article['title']} -> {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
