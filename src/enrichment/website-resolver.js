import { canonicalCompanyName, canonicalDomain, normalizeWhitespace } from '../lib/normalize.js';

const BLOCKED_DOMAINS = [
  'ashbyhq.com', 'greenhouse.io', 'lever.co', 'remoteok.com', 'arbeitnow.com', 'linkedin.com',
  'crunchbase.com', 'wellfound.com', 'angel.co', 'glassdoor.com', 'indeed.com', 'ziprecruiter.com',
  'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'youtube.com', 'github.com', 'notion.site',
  'workable.com', 'smartrecruiters.com', 'icims.com', 'jobvite.com', 'bamboohr.com', 'teamtailor.com',
  'boards.greenhouse.io', 'jobs.lever.co', 'api.lever.co', 'jobs.ashbyhq.com'
];

export function isBlockedWebsiteDomain(urlOrDomain) {
  const domain = canonicalDomain(urlOrDomain);
  if (!domain) return true;
  return BLOCKED_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}

export async function resolveCompanyWebsite(company, jobs, http, options = {}) {
  const discovery = options.websiteDiscovery || {};
  if (discovery.enabled === false) return notFound('disabled');

  const candidates = [];
  const companyName = company.name?.value || '';
  const companySlug = slugify(companyName);

  if (discovery.fetchJobDescriptionLinks !== false) {
    for (const job of jobs) {
      for (const url of extractUrls(job.description || '')) {
        candidates.push(scoreCandidate(url, 'job_description_url', job.job_url, companyName, companySlug));
      }
    }
  }

  if (discovery.fetchCareerPageLinks !== false) {
    const pagesToFetch = [...new Set(jobs.flatMap((job) => [publicCareerPageFor(job), job.job_url]).filter(Boolean))].slice(0, 5);
    for (const pageUrl of pagesToFetch) {
      try {
        const html = await http.fetchText(pageUrl);
        for (const link of extractLinks(html, pageUrl)) {
          candidates.push(scoreCandidate(link.href, 'career_page_outbound_link', pageUrl, companyName, companySlug, link.text));
        }
      } catch {
        // Website discovery is best-effort; source failures must not fail the run.
      }
    }
  }

  if (discovery.useWikidata !== false && companyName) {
    const wikidata = await wikidataWebsite(companyName, http);
    if (wikidata?.url) candidates.push(scoreCandidate(wikidata.url, 'wikidata_official_website', wikidata.sourceUrl, companyName, companySlug));
  }

  const viable = candidates
    .filter((candidate) => candidate.url && !isBlockedWebsiteDomain(candidate.url) && candidate.score >= 0.55)
    .sort((a, b) => b.score - a.score);

  const best = viable[0];
  if (!best) return notFound('no_verified_candidate');

  return {
    value: normalizeWebsite(best.url),
    source: best.source,
    source_url: best.sourceUrl,
    confidence: best.score >= 0.85 ? 'high' : 'medium',
    is_estimated: false,
    candidate_score: Number(best.score.toFixed(2)),
    reasons: best.reasons,
    verified_at: new Date().toISOString(),
  };
}

export function extractUrls(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s"'<>),]+/gi) || [];
  return [...new Set(matches.map((url) => url.replace(/[.)]+$/, '')))];
}

function extractLinks(html, baseUrl) {
  const links = [];
  const anchorRe = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(html))) {
    const attrs = match[1];
    const hrefMatch = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    try {
      const href = new URL(hrefMatch[1], baseUrl).toString();
      links.push({ href, text: normalizeWhitespace(match[2].replace(/<[^>]+>/g, ' ')) });
    } catch {
      // Ignore malformed links.
    }
  }
  return links;
}

function scoreCandidate(url, source, sourceUrl, companyName, companySlug, linkText = '') {
  const domain = canonicalDomain(url);
  const normalizedDomain = String(domain || '').replace(/\./g, '');
  const normalizedName = canonicalCompanyName(companyName).replace(/\s+/g, '');
  const text = `${url} ${linkText}`.toLowerCase();
  const reasons = [];
  let score = 0.35;

  if (!domain || isBlockedWebsiteDomain(domain)) return { url, source, sourceUrl, score: 0, reasons: ['blocked_or_invalid_domain'] };
  if (normalizedName && normalizedDomain.includes(normalizedName)) {
    score += 0.35;
    reasons.push('domain_contains_company_name');
  }
  if (companySlug && normalizedDomain.includes(companySlug)) {
    score += 0.25;
    reasons.push('domain_contains_company_slug');
  }
  if (/\b(website|home|company|about|visit)\b/i.test(linkText)) {
    score += 0.15;
    reasons.push('link_text_indicates_company_website');
  }
  if (new URL(url).pathname.replace(/\/$/, '') === '') {
    score += 0.1;
    reasons.push('root_domain');
  }
  if (url.startsWith('https://')) score += 0.05;
  if (source === 'wikidata_official_website') {
    score += 0.15;
    reasons.push('wikidata_official_website');
  }

  return { url, source, sourceUrl, score: Math.min(score, 1), reasons };
}

async function wikidataWebsite(companyName, http) {
  const query = `SELECT ?item ?website WHERE { ?item rdfs:label "${escapeSparql(companyName)}"@en. OPTIONAL { ?item wdt:P856 ?website. } } LIMIT 1`;
  const sourceUrl = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  try {
    const payload = await http.fetchJson(sourceUrl, { headers: { Accept: 'application/sparql-results+json' } });
    const website = payload?.results?.bindings?.[0]?.website?.value;
    return website ? { url: website, sourceUrl } : null;
  } catch {
    return null;
  }
}

function publicCareerPageFor(job) {
  if (job.source === 'ashby') {
    const match = String(job.source_url || '').match(/job-board\/([^?]+)/);
    return match ? `https://jobs.ashbyhq.com/${match[1]}` : null;
  }
  if (job.source === 'lever') {
    const match = String(job.source_url || '').match(/postings\/([^?]+)/);
    return match ? `https://jobs.lever.co/${match[1]}` : null;
  }
  if (job.source === 'greenhouse') {
    const match = String(job.source_url || '').match(/boards\/([^/]+)\/jobs/);
    return match ? `https://boards.greenhouse.io/${match[1]}` : null;
  }
  return null;
}

function normalizeWebsite(url) {
  const parsed = new URL(url);
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
  return parsed.toString();
}

function notFound(reason) {
  return { value: 'not found', source: reason, source_url: null, confidence: 'none', is_estimated: false, candidate_score: 0, reasons: [] };
}

function slugify(value) {
  return canonicalCompanyName(value).replace(/[^a-z0-9]/g, '');
}

function escapeSparql(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
