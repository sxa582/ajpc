import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ISSN = '2666-6677';
const ARTICLE_LIMIT = 12;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(projectRoot, 'data', 'articles.json');
const endpoint = new URL(`https://api.crossref.org/journals/${ISSN}/works`);

endpoint.searchParams.set('rows', String(ARTICLE_LIMIT));
// Crossref's created timestamp tracks the newest DOI deposits, which most
// closely matches ScienceDirect's "Latest published" ordering for AJPC.
endpoint.searchParams.set('sort', 'created');
endpoint.searchParams.set('order', 'desc');
endpoint.searchParams.set('filter', 'type:journal-article');
endpoint.searchParams.set('mailto', '287317949+sxa582@users.noreply.github.com');

const response = await fetch(endpoint, {
  headers: {
    Accept: 'application/json',
    'User-Agent': 'AJPC website metadata updater/1.0 (mailto:287317949+sxa582@users.noreply.github.com)'
  }
});

if (!response.ok) {
  throw new Error(`Crossref request failed: ${response.status} ${response.statusText}`);
}

const payload = await response.json();
const sourceItems = payload?.message?.items;

if (!Array.isArray(sourceItems)) {
  throw new Error('Crossref returned an unexpected response.');
}

const titleCase = value => String(value || 'Journal Article')
  .split(/[-_ ]+/)
  .filter(Boolean)
  .map(word => word[0].toUpperCase() + word.slice(1))
  .join(' ');

const dateFromParts = parts => {
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return null;
  const [year, month = 1, day = 1] = parts[0];
  if (!year) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const dateFromTimestamp = value => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
};

const formatAuthor = author => [author?.given, author?.family].filter(Boolean).join(' ').trim();

const articles = sourceItems
  .filter(item => item?.DOI && Array.isArray(item?.title) && item.title[0])
  .map(item => {
    const authorNames = (item.author || []).map(formatAuthor).filter(Boolean);
    const published = dateFromParts(item['published-online']?.['date-parts'])
      || dateFromParts(item.published?.['date-parts'])
      || dateFromParts(item.issued?.['date-parts'])
      || dateFromTimestamp(item.created?.['date-time']);

    return {
      doi: item.DOI,
      title: item.title[0],
      authors: authorNames.length ? authorNames.join(', ') : 'AJPC Editorial Team',
      authorsShort: authorNames.length > 2 ? `${authorNames[0]} et al.` : authorNames.join(', ') || 'AJPC Editorial Team',
      published,
      articleType: titleCase(item.subtype || item.type),
      volume: item.volume || null,
      issue: item.issue || null,
      url: `https://doi.org/${item.DOI}`
    };
  })
  .slice(0, ARTICLE_LIMIT);

if (articles.length === 0) {
  throw new Error('No AJPC articles were returned; preserving the existing cache.');
}

let previous = null;
try {
  previous = JSON.parse(await readFile(outputPath, 'utf8'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const unchanged = JSON.stringify(previous?.articles) === JSON.stringify(articles);
const output = {
  source: 'Crossref metadata for American Journal of Preventive Cardiology',
  issn: ISSN,
  updatedAt: unchanged && previous?.updatedAt ? previous.updatedAt : new Date().toISOString(),
  articles
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Cached ${articles.length} AJPC articles${unchanged ? ' (no metadata changes)' : ''}.`);
