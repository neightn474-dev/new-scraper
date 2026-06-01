import { extractSkills, inferDepartment, inferExperienceLevel, normalizeWhitespace, stableHash, stripHtml } from '../lib/normalize.js';

export function detectAts(url) {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const pathParts = parsed.pathname.split('/').filter(Boolean);

  if (host.includes('greenhouse.io')) {
    const board = host === 'boards.greenhouse.io' ? pathParts[0] : pathParts.at(-1);
    return board ? { provider: 'greenhouse', slug: board } : null;
  }
  if (host === 'jobs.lever.co' || host === 'api.lever.co') {
    const slug = host === 'api.lever.co' ? pathParts[2] : pathParts[0];
    return slug ? { provider: 'lever', slug } : null;
  }
  if (host.includes('ashbyhq.com')) {
    const slug = pathParts[0] === 'posting-api' ? pathParts.at(-1) : pathParts[0];
    return slug ? { provider: 'ashby', slug } : null;
  }
  return null;
}

export async function scrapeCareerUrl(url, http, { maxJobsPerSource = 100 } = {}) {
  const detected = detectAts(url);
  if (!detected) {
    return { source: 'unknown', status: 'skipped', jobs: [], error: 'Unsupported or custom career page; add an adapter before scraping.' };
  }
  if (detected.provider === 'greenhouse') return scrapeGreenhouse(detected.slug, http, maxJobsPerSource);
  if (detected.provider === 'lever') return scrapeLever(detected.slug, http, maxJobsPerSource);
  if (detected.provider === 'ashby') return scrapeAshby(detected.slug, http, maxJobsPerSource);
  return { source: detected.provider, status: 'skipped', jobs: [] };
}

async function scrapeGreenhouse(board, http, maxJobs) {
  const sourceUrl = `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`;
  const payload = await http.fetchJson(sourceUrl);
  const jobs = (payload.jobs || []).slice(0, maxJobs).map((job) => {
    const description = stripHtml(job.content || '');
    const title = normalizeWhitespace(job.title);
    return {
      job_id: `greenhouse:${job.id || stableHash(job.absolute_url || title)}`,
      source: 'greenhouse',
      source_url: sourceUrl,
      company_name: board,
      title,
      headline: description.slice(0, 220) || 'not found',
      department: job.departments?.[0]?.name || inferDepartment(`${title} ${description}`),
      location: job.location?.name || 'not found',
      remote_status: inferRemote(job.location?.name || description),
      salary_range: parseGreenhousePay(job.pay_input_ranges),
      required_skills: extractSkills(description),
      experience_level: inferExperienceLevel(`${title} ${description}`),
      job_url: job.absolute_url || 'not found',
      date_posted: job.updated_at || 'not found',
      description,
      posting_type: 'employer_direct',
    };
  });
  return { source: 'greenhouse', status: 'success', jobs };
}

async function scrapeLever(site, http, maxJobs) {
  const sourceUrl = `https://api.lever.co/v0/postings/${site}?mode=json`;
  const payload = await http.fetchJson(sourceUrl);
  const jobs = (Array.isArray(payload) ? payload : []).slice(0, maxJobs).map((job) => {
    const description = normalizeWhitespace(job.descriptionPlain || job.openingPlain || stripHtml(job.description || ''));
    const title = normalizeWhitespace(job.text);
    return {
      job_id: `lever:${job.id || stableHash(job.hostedUrl || title)}`,
      source: 'lever',
      source_url: sourceUrl,
      company_name: site,
      title,
      headline: description.slice(0, 220) || 'not found',
      department: job.categories?.team || job.categories?.department || inferDepartment(`${title} ${description}`),
      location: job.categories?.location || job.country || 'not found',
      remote_status: job.workplaceType || inferRemote(`${job.categories?.location || ''} ${description}`),
      salary_range: job.salaryRange || 'not found',
      required_skills: extractSkills(description),
      experience_level: inferExperienceLevel(`${title} ${description}`),
      job_url: job.hostedUrl || job.applyUrl || 'not found',
      date_posted: job.createdAt ? new Date(job.createdAt).toISOString() : 'not found',
      description,
      posting_type: 'employer_direct',
    };
  });
  return { source: 'lever', status: 'success', jobs };
}

async function scrapeAshby(board, http, maxJobs) {
  const sourceUrl = `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`;
  const payload = await http.fetchJson(sourceUrl);
  const jobs = (payload.jobs || []).slice(0, maxJobs).map((job) => {
    const description = stripHtml(job.descriptionHtml || job.descriptionPlain || '');
    const title = normalizeWhitespace(job.title);
    return {
      job_id: `ashby:${job.id || stableHash(job.jobUrl || title)}`,
      source: 'ashby',
      source_url: sourceUrl,
      company_name: payload.name || board,
      title,
      headline: description.slice(0, 220) || 'not found',
      department: job.department || inferDepartment(`${title} ${description}`),
      location: job.location || formatAshbyLocation(job.location) || 'not found',
      remote_status: inferRemote(`${job.location || ''} ${description}`),
      salary_range: formatAshbyCompensation(job.compensation),
      required_skills: extractSkills(description),
      experience_level: inferExperienceLevel(`${title} ${description}`),
      job_url: job.jobUrl || 'not found',
      date_posted: job.publishedAt || 'not found',
      description,
      posting_type: 'employer_direct',
    };
  });
  return { source: 'ashby', status: 'success', jobs };
}

function inferRemote(text) {
  const value = String(text || '').toLowerCase();
  if (value.includes('remote')) return 'remote';
  if (value.includes('hybrid')) return 'hybrid';
  return 'not found';
}

function parseGreenhousePay(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) return 'not found';
  return ranges.map((range) => [range.min_value, range.max_value, range.currency, range.unit].filter(Boolean).join(' ')).join('; ');
}

function formatAshbyCompensation(comp) {
  if (!comp) return 'not found';
  if (typeof comp === 'string') return comp;
  const parts = [comp.compensationTierSummary, comp.summary, comp.minValue, comp.maxValue, comp.currencyCode].filter(Boolean);
  return parts.length ? parts.join(' ') : 'not found';
}

function formatAshbyLocation(location) {
  if (!location) return null;
  if (typeof location === 'string') return location;
  return location.name || null;
}
