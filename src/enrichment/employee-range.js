import { normalizeWhitespace } from '../lib/normalize.js';

const CONFIDENCE_RANK = { none: 0, low: 1, medium: 2, high: 3 };

export async function resolveEmployeeRange(company, jobs, http, options = {}) {
  const discovery = options.employeeRangeDiscovery || {};
  if (discovery.enabled === false) return notFound('disabled');

  const candidates = [];
  const website = company.website_url?.value !== 'not found' ? company.website_url?.value : null;

  for (const job of jobs) {
    candidates.push(...extractEmployeeRanges(job.description || '', job.job_url, 'job_description', 'low'));
  }

  if (website && discovery.useCompanyWebsite !== false) {
    const pages = candidateCompanyPages(website).slice(0, Math.max(1, Number(discovery.maxPagesPerCompany || 4)));
    for (const pageUrl of pages) {
      try {
        const html = await http.fetchText(pageUrl);
        candidates.push(...extractEmployeeRanges(html, pageUrl, 'company_website', 'high'));
      } catch {
        // Best-effort enrichment; failed pages should not fail source collection.
      }
    }
  }

  if (discovery.useWikidata !== false && company.name?.value) {
    const wikidata = await wikidataEmployeeCount(company.name.value, http);
    if (wikidata) candidates.push(wikidata);
  }

  const best = candidates.sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] || rangeSpecificity(a) - rangeSpecificity(b))[0];
  if (!best) return notFound('no_verified_employee_range');
  return {
    min: best.min,
    max: best.max,
    label: `${best.min}-${best.max}`,
    source: best.source,
    source_url: best.source_url,
    confidence: best.confidence,
    is_estimated: best.confidence !== 'high',
    extracted_text: best.extracted_text,
    verified_at: new Date().toISOString(),
  };
}

export function employeeRangeMatches(employeeRange, filter = {}) {
  if (!filter.enabled) return true;
  if (!employeeRange || employeeRange.label === 'not found') return filter.unknownCompanySizePolicy === 'include';
  if (CONFIDENCE_RANK[employeeRange.confidence || 'none'] < CONFIDENCE_RANK[filter.minimumConfidence || 'medium']) return false;

  const min = Number(filter.minEmployees || 0);
  const max = Number(filter.maxEmployees || Number.MAX_SAFE_INTEGER);
  if (filter.matchMode === 'contained') return employeeRange.min >= min && employeeRange.max <= max;
  return employeeRange.max >= min && employeeRange.min <= max;
}

export function extractEmployeeRanges(text, sourceUrl, source, defaultConfidence = 'medium') {
  const compact = normalizeWhitespace(String(text || '').replace(/<[^>]+>/g, ' '));
  const candidates = [];
  const patterns = [
    /(?:team size|company size|employees|headcount)\s*[:\-]?\s*(\d{1,3}(?:,\d{3})?)\s*(?:-|–|to)\s*(\d{1,3}(?:,\d{3})?)\s*(?:employees|people|team members|staff)?/gi,
    /(\d{1,3}(?:,\d{3})?)\s*(?:-|–|to)\s*(\d{1,3}(?:,\d{3})?)\s*(?:employees|people|team members|staff)/gi,
    /(?:team of|team with|we are)\s*(?:over|more than|around|approximately|about)?\s*(\d{1,3}(?:,\d{3})?)\s*(?:employees|people|team members|staff)?/gi,
    /(?:over|more than|above)\s*(\d{1,3}(?:,\d{3})?)\s*(?:employees|people|team members|staff)/gi,
    /(\d{1,3}(?:,\d{3})?)\s*\+\s*(?:employees|people|team members|staff)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(compact))) {
      const values = match.slice(1).filter(Boolean).map(parseCount);
      if (!values.length) continue;
      const min = values[0];
      const max = values[1] || bucketMax(min);
      if (!isPlausible(min, max)) continue;
      candidates.push({ min, max, source, source_url: sourceUrl, confidence: defaultConfidence, extracted_text: match[0] });
    }
  }
  return candidates;
}

function candidateCompanyPages(website) {
  const root = new URL(website).origin;
  return [root, `${root}/about`, `${root}/company`, `${root}/team`, `${root}/careers`, `${root}/jobs`];
}

async function wikidataEmployeeCount(companyName, http) {
  const query = `SELECT ?item ?employees WHERE { ?item rdfs:label "${escapeSparql(companyName)}"@en. OPTIONAL { ?item wdt:P1128 ?employees. } } LIMIT 1`;
  const sourceUrl = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  try {
    const payload = await http.fetchJson(sourceUrl, { headers: { Accept: 'application/sparql-results+json' } });
    const value = payload?.results?.bindings?.[0]?.employees?.value;
    if (!value) return null;
    const count = parseCount(value);
    return { min: count, max: count, source: 'wikidata_employee_count', source_url: sourceUrl, confidence: 'medium', extracted_text: value };
  } catch {
    return null;
  }
}

function parseCount(value) {
  return Number(String(value).replace(/,/g, ''));
}

function bucketMax(min) {
  if (min < 10) return 10;
  if (min < 50) return 50;
  if (min < 100) return 100;
  if (min < 250) return 250;
  if (min < 500) return 500;
  if (min < 1000) return 1000;
  return Math.ceil(min * 1.25);
}

function isPlausible(min, max) {
  return Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min && max < 1_000_000;
}

function rangeSpecificity(range) {
  return Math.max(0, range.max - range.min);
}

function notFound(source) {
  return { min: null, max: null, label: 'not found', source, source_url: null, confidence: 'none', is_estimated: false, extracted_text: null };
}

function escapeSparql(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
