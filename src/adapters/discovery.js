import { extractSkills, inferDepartment, inferExperienceLevel, normalizeWhitespace, stableHash, stripHtml } from '../lib/normalize.js';

export async function scrapeRemoteOk(http, { maxJobsPerSource = 100 } = {}) {
  const sourceUrl = 'https://remoteok.com/api';
  const payload = await http.fetchJson(sourceUrl);
  const rows = Array.isArray(payload) ? payload.filter((row) => row && row.position && row.company) : [];
  const jobs = rows.slice(0, maxJobsPerSource).map((row) => {
    const description = stripHtml(row.description || '');
    const title = normalizeWhitespace(row.position);
    return {
      job_id: `remoteok:${row.id || stableHash(row.url || `${row.company}:${title}`)}`,
      source: 'remoteok',
      source_url: sourceUrl,
      company_name: normalizeWhitespace(row.company),
      title,
      headline: description.slice(0, 220) || 'not found',
      department: inferDepartment(`${title} ${description} ${(row.tags || []).join(' ')}`),
      location: row.location || 'not found',
      remote_status: 'remote',
      salary_range: formatSalary(row.salary_min, row.salary_max),
      required_skills: Array.isArray(row.tags) && row.tags.length ? row.tags.slice(0, 20) : extractSkills(description),
      experience_level: inferExperienceLevel(`${title} ${description}`),
      job_url: row.url || row.apply_url || 'not found',
      date_posted: row.date || 'not found',
      description,
      posting_type: 'employer_direct',
    };
  });
  return { source: 'remoteok', status: 'success', jobs };
}

export async function scrapeArbeitnow(http, { maxJobsPerSource = 100 } = {}) {
  const sourceUrl = 'https://www.arbeitnow.com/api/job-board-api';
  const payload = await http.fetchJson(sourceUrl);
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const jobs = rows.slice(0, maxJobsPerSource).map((row) => {
    const description = stripHtml(row.description || '');
    const title = normalizeWhitespace(row.title);
    return {
      job_id: `arbeitnow:${row.slug || stableHash(row.url || `${row.company_name}:${title}`)}`,
      source: 'arbeitnow',
      source_url: sourceUrl,
      company_name: normalizeWhitespace(row.company_name),
      title,
      headline: description.slice(0, 220) || 'not found',
      department: inferDepartment(`${title} ${description} ${(row.tags || []).join(' ')}`),
      location: row.location || 'not found',
      remote_status: row.remote ? 'remote' : inferRemote(description),
      salary_range: extractSalaryHint(description),
      required_skills: Array.isArray(row.tags) && row.tags.length ? row.tags.slice(0, 20) : extractSkills(description),
      experience_level: inferExperienceLevel(`${title} ${description}`),
      job_url: row.url || 'not found',
      date_posted: row.created_at ? new Date(row.created_at * 1000).toISOString() : 'not found',
      description,
      posting_type: inferRecruiterPosting(row.company_name, description) ? 'recruitment_firm' : 'employer_direct',
      recruitment_firm_name: inferRecruiterPosting(row.company_name, description) ? row.company_name : 'not applicable',
      client_company_name: inferRecruiterPosting(row.company_name, description) ? 'not disclosed' : row.company_name,
    };
  });
  return { source: 'arbeitnow', status: 'success', jobs };
}

export async function scrapeHackerNews(http, { maxJobsPerSource = 50 } = {}) {
  const sourceUrl = 'https://hn.algolia.com/api/v1/search_by_date?query=%22Who%20is%20hiring%22&tags=story';
  const payload = await http.fetchJson(sourceUrl);
  const rows = Array.isArray(payload.hits) ? payload.hits : [];
  const jobs = rows.slice(0, maxJobsPerSource).map((row) => ({
    job_id: `hn:${row.objectID}`,
    source: 'hacker_news_algolia',
    source_url: sourceUrl,
    company_name: 'not found',
    title: row.title || 'Who is hiring thread',
    headline: 'Startup hiring discovery thread; inspect comments before treating as employer-direct job data.',
    department: 'not found',
    location: 'not found',
    remote_status: 'not found',
    salary_range: 'not found',
    required_skills: [],
    experience_level: 'not found',
    job_url: row.url || `https://news.ycombinator.com/item?id=${row.objectID}`,
    date_posted: row.created_at || 'not found',
    description: row.title || '',
    posting_type: 'discovery_signal',
  }));
  return { source: 'hacker_news_algolia', status: 'success', jobs };
}

function formatSalary(min, max) {
  if (!min && !max) return 'not found';
  return [min, max].filter((value) => Number(value) > 0).join('-') || 'not found';
}

function inferRemote(text) {
  const value = String(text || '').toLowerCase();
  if (value.includes('remote')) return 'remote';
  if (value.includes('hybrid')) return 'hybrid';
  return 'not found';
}

function extractSalaryHint(text) {
  const match = String(text || '').match(/(?:€|\$|£)\s?[0-9][0-9,.kK\s-]{2,40}/);
  return match ? normalizeWhitespace(match[0]) : 'not found';
}

function inferRecruiterPosting(companyName, description) {
  const text = `${companyName || ''} ${description || ''}`.toLowerCase();
  return ['staffing', 'recruitment', 'recruiting', 'executive search', 'headhunt', 'client is looking', 'our client'].some((term) => text.includes(term));
}
