import fs from 'node:fs/promises';
import { normalizeWhitespace } from '../lib/normalize.js';

export async function loadMiddleEastTerms(path = 'config/region_exclusions.json') {
  const config = JSON.parse(await fs.readFile(path, 'utf8'));
  return [...config.countries, ...config.cities].map((term) => term.toLowerCase());
}

export function hasMiddleEastSignal(record, terms) {
  const checked = [
    record.company_name,
    record.company?.name,
    record.company?.location?.value,
    record.location,
    record.remote_status,
    record.description,
    record.title,
    record.job_url,
    record.source_url,
  ].filter(Boolean);
  const text = normalizeWhitespace(checked.join(' | ')).toLowerCase();
  const matchedTerms = terms.filter((term) => new RegExp(`(^|[^a-z])${escapeRegExp(term)}([^a-z]|$)`, 'i').test(text));
  return { excluded: matchedTerms.length > 0, matchedTerms };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
