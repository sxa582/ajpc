# AJPC Native Article Reader

This project converts the supplied AJPC landing-page concept into a static journal website that can display eligible **CC BY** articles directly on the AJPC domain.

## What is included

- `index.html` — redesigned AJPC landing page and searchable article library
- `article.html` — native full-text article reader
- `assets/styles.css` — visual system adapted from the supplied template
- `assets/site.js` — issue feed, search, topic filtering, and internal article links
- `assets/article.js` — article rendering, table of contents, citation copy, print view, figures, tables, and references
- `data/articles.json` — journal article index
- `data/articles/PMC....json` — one structured JSON file per article
- `scripts/import_pmc.py` — imports one PMC JATS XML record
- `scripts/sync_ajpc.py` — finds AJPC records in PMC, accepts only strict CC BY articles, and rebuilds the site index

The bundled article record is a reader demonstration. Running the sync command replaces demonstration content with complete JATS-derived full text for eligible articles.

## Preview locally

Browsers block local JSON requests when an HTML file is opened directly. Serve the folder through a local web server:

```bash
cd ajpc-native-reader
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

## Import all eligible AJPC articles

NCBI asks automated clients to identify themselves with a contact email. Set it before running the synchronization:

```bash
export NCBI_EMAIL="your-email@journal.org"
python scripts/sync_ajpc.py --download-assets --keep-going
```

On Windows PowerShell:

```powershell
$env:NCBI_EMAIL="your-email@journal.org"
python scripts/sync_ajpc.py --download-assets --keep-going
```

The script searches PMC for the journal, downloads full JATS XML through NCBI EFetch, checks each article’s license, and skips anything that is not strict CC BY.

To import one article:

```bash
python scripts/import_pmc.py PMC13330701 --email your-email@journal.org --download-assets
```

An NCBI API key can be supplied through `NCBI_API_KEY` for a higher permitted request rate.

## Deployment

This is a static site after synchronization. It can be hosted on:

- the AJPC web server
- Netlify
- Vercel static hosting
- GitHub Pages
- Amazon S3 and CloudFront
- Cloudflare Pages

For a production journal site, run `sync_ajpc.py` on a schedule, commit or publish the updated `data/` and downloaded figure assets, and invalidate the site cache.

## Important publishing safeguards

1. Keep the license statement, DOI, PMCID, authors, and original citation visible on every article.
2. Do not import articles that are merely present in PMC but are not reusable under the required license.
3. Review figure and table credit lines for third-party material excluded from the article-level CC license.
4. Add correction, retraction, and version checks before production launch.
5. Have Elsevier or the journal’s publishing contact approve use of publisher trademarks, logos, and branded PDF files separately from article copyright.

## Official technical references

- PMC developer services: https://pmc.ncbi.nlm.nih.gov/tools/developers/
- NCBI EFetch documentation: https://www.ncbi.nlm.nih.gov/books/NBK25499/
- PMC copyright and reuse: https://pmc.ncbi.nlm.nih.gov/about/copyright/
- CC BY 4.0: https://creativecommons.org/licenses/by/4.0/
