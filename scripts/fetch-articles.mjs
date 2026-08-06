import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ISSN = '2666-6677';
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(projectRoot, 'data', 'articles.json');
const endpoint = new URL(`https://api.crossref.org/journals/${ISSN}/works`);
const today = new Date();
const oneYearAgo = new Date(today);
oneYearAgo.setUTCFullYear(today.getUTCFullYear() - 1);

endpoint.searchParams.set('rows', '1000');
endpoint.searchParams.set('sort', 'published');
endpoint.searchParams.set('order', 'desc');
endpoint.searchParams.set('filter', [
  'type:journal-article',
  `from-pub-date:${oneYearAgo.toISOString().slice(0, 10)}`,
  `until-pub-date:${today.toISOString().slice(0, 10)}`
].join(','));
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

const assignedVolumes = sourceItems
  .map(item => Number.parseInt(item.volume, 10))
  .filter(Number.isFinite);
const currentVolume = Math.max(...assignedVolumes);

if (!Number.isFinite(currentVolume)) {
  throw new Error('No assigned AJPC volume was returned; preserving the existing cache.');
}

const themeOrder = [
  'Lipids & Atherosclerosis',
  'Cardiometabolic Health',
  'Digital Health, AI & Imaging',
  'Women’s Health & Health Equity',
  'Lifestyle, Environment & Population Health',
  'Clinical Prevention & Outcomes'
];

const classifyTheme = title => {
  const value = title.toLowerCase();
  if (/ldl|lipid|statin|cholesterol|lipoprotein|pcsk9|inclisiran|obicetrapib|bempedoic|apoc3|atherosclero/.test(value)) return themeOrder[0];
  if (/obesity|metabolic|diabet|cardiovascular-kidney|\bckm\b|adiposity|incretin|semaglutide|kidney|masld|hepatic/.test(value)) return themeOrder[1];
  if (/artificial intelligence|\bai\b|machine learning|deep learning|wearable|imaging|\bct\b|ccta|calcium|proteomic|multiomic|octa|\becg\b|biobank|digital|algorithm|prediction model|risk model/.test(value)) return themeOrder[2];
  if (/women|female|sex difference|sex-based|pregnan|preconception|menopause|hispanic|racial|social risk|disparit|equity|sociodemographic/.test(value)) return themeOrder[3];
  if (/exercise|physical activity|diet|nutrition|smoking|e-cig|air pollution|green space|urban|environment|rehabilitation|resistance training|health literacy/.test(value)) return themeOrder[4];
  return themeOrder[5];
};

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
const uniqueItems = new Map();

for (const item of sourceItems) {
  if (Number.parseInt(item?.volume, 10) !== currentVolume || !item?.DOI || !item?.title?.[0]) continue;
  uniqueItems.set(item.DOI.toLowerCase(), item);
}

const articles = [...uniqueItems.values()]
  .map(item => {
    const authorNames = (item.author || []).map(formatAuthor).filter(Boolean);
    const published = dateFromParts(item['published-online']?.['date-parts'])
      || dateFromParts(item.published?.['date-parts'])
      || dateFromParts(item.issued?.['date-parts'])
      || dateFromTimestamp(item.created?.['date-time']);
    const title = item.title[0];

    return {
      doi: item.DOI,
      title,
      authors: authorNames.length ? authorNames.join(', ') : 'AJPC Editorial Team',
      authorsShort: authorNames.length > 2 ? `${authorNames[0]} et al.` : authorNames.join(', ') || 'AJPC Editorial Team',
      published,
      articleType: titleCase(item.subtype || item.type),
      theme: classifyTheme(title),
      volume: String(currentVolume),
      issue: item.issue || null,
      url: `https://doi.org/${item.DOI}`
    };
  })
  .sort((a, b) => themeOrder.indexOf(a.theme) - themeOrder.indexOf(b.theme) || a.title.localeCompare(b.title));

if (articles.length === 0) {
  throw new Error(`No papers were returned for AJPC volume ${currentVolume}; preserving the existing cache.`);
}

let previous = null;
try {
  previous = JSON.parse(await readFile(outputPath, 'utf8'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const unchanged = previous?.currentVolume === String(currentVolume)
  && JSON.stringify(previous?.articles) === JSON.stringify(articles);
const output = {
  source: 'Crossref metadata for American Journal of Preventive Cardiology',
  issn: ISSN,
  currentVolume: String(currentVolume),
  updatedAt: unchanged && previous?.updatedAt ? previous.updatedAt : new Date().toISOString(),
  themeOrder,
  articles
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Cached all ${articles.length} papers from AJPC volume ${currentVolume}${unchanged ? ' (no metadata changes)' : ''}.`);
