import { employeeRangeMatches, resolveEmployeeRange } from './employee-range.js';
import { isBlockedWebsiteDomain, resolveCompanyWebsite } from './website-resolver.js';
import { canonicalCompanyName, canonicalDomain, makeEvidence, normalizeWhitespace, stableHash } from '../lib/normalize.js';

export function buildCompaniesFromJobs(jobs) {
  const companies = new Map();
  for (const job of jobs) {
    const domain = isBlockedWebsiteDomain(job.job_url) ? null : canonicalDomain(job.job_url);
    const companyKey = canonicalCompanyName(job.company_name) || domain || stableHash(job.company_name);
    if (!companies.has(companyKey)) {
      companies.set(companyKey, {
        company_id: companyKey,
        name: makeEvidence(displayCompanyName(job.company_name), job.job_url, 'medium', false),
        website_url: websiteEvidence('not found'),
        website: makeEvidence('not found', null, 'none', false),
        careers_url: makeEvidence(firstCareerUrl(job), job.source_url || job.job_url, 'high', false),
        linkedin_url: makeEvidence('not found', null, 'none', false),
        ceo_or_founder: makeEvidence('not found', null, 'none', false),
        business_model: makeEvidence(inferBusinessModel(job), job.job_url, inferBusinessModel(job) === 'not found' ? 'none' : 'low', inferBusinessModel(job) !== 'not found'),
        main_product_or_service: makeEvidence('not found', null, 'none', false),
        revenue_streams: makeEvidence('not found', null, 'none', false),
        estimated_revenue: makeEvidence('not found', null, 'none', false),
        employee_range: employeeRangeNotFound(),
        company_size: makeEvidence('not found', null, 'none', false),
        industry: makeEvidence(inferIndustry(job), job.job_url, inferIndustry(job) === 'not found' ? 'none' : 'low', inferIndustry(job) !== 'not found'),
        location: makeEvidence(job.location || 'not found', job.job_url, job.location && job.location !== 'not found' ? 'low' : 'none', true),
        growth_stage: makeEvidence('not found', null, 'none', false),
        recent_funding: {
          amount: 'not found',
          date: 'not found',
          investors: [],
          source_url: null,
          confidence: 'none'
        },
        recent_news_or_growth_signals: [],
        hiring_intent_summary: makeEvidence('not found', null, 'none', false),
        job_ids: [],
      });
    }
    companies.get(companyKey).job_ids.push(job.job_id);
  }

  for (const company of companies.values()) {
    company.hiring_intent_summary = makeEvidence(summarizeHiringIntent(company, jobs), 'derived from current job mix', 'medium', true);
  }
  return [...companies.values()];
}

export async function enrichCompanies(companies, http, options = {}) {
  const jobs = options.jobs || [];
  const enriched = [];
  for (const company of companies.slice(0, Number(options.maxCompaniesToEnrich || companies.length))) {
    const companyJobs = jobs.filter((job) => company.job_ids.includes(job.job_id));
    const website = await resolveCompanyWebsite(company, companyJobs, http, options);
    company.website_url = website;
    company.website = makeEvidence(website.value, website.source_url, website.confidence, website.is_estimated);
    company.employee_range = await resolveEmployeeRange(company, companyJobs, http, options);
    company.company_size = employeeRangeToEvidence(company.employee_range);
    enriched.push(company);
  }
  return enriched.concat(companies.slice(enriched.length));
}

export function filterCompaniesByEmployeeRange(companies, jobs, filter = {}) {
  if (!filter.enabled) return { companies, jobs, excludedCompanyCount: 0, excludedJobCount: 0 };
  const includedCompanies = companies.filter((company) => employeeRangeMatches(company.employee_range, filter));
  const includedIds = new Set(includedCompanies.flatMap((company) => company.job_ids));
  const includedJobs = jobs.filter((job) => includedIds.has(job.job_id));
  return {
    companies: includedCompanies,
    jobs: includedJobs,
    excludedCompanyCount: companies.length - includedCompanies.length,
    excludedJobCount: jobs.length - includedJobs.length,
  };
}

export function attachCompanyDataToJobs(jobs, companies) {
  const byJobId = new Map();
  for (const company of companies) {
    for (const jobId of company.job_ids) byJobId.set(jobId, company);
  }
  return jobs.map((job) => {
    const company = byJobId.get(job.job_id);
    if (!company) return job;
    return {
      ...job,
      company_website_url: company.website_url?.value || 'not found',
      company_website_url_source: company.website_url?.source || 'not found',
      company_website_url_confidence: company.website_url?.confidence || 'none',
      company_employee_min: company.employee_range?.min,
      company_employee_max: company.employee_range?.max,
      company_employee_range_label: company.employee_range?.label || 'not found',
      company_employee_range_source: company.employee_range?.source || 'not found',
      company_employee_range_confidence: company.employee_range?.confidence || 'none',
    };
  });
}

function displayCompanyName(name) {
  const value = normalizeWhitespace(name);
  return value || 'not found';
}

function inferBusinessModel(job) {
  const text = `${job.title || ''} ${job.description || ''}`.toLowerCase();
  if (text.includes('saas') || text.includes('subscription')) return 'estimated: SaaS/subscription';
  if (text.includes('marketplace')) return 'estimated: marketplace';
  if (text.includes('agency') || text.includes('services')) return 'estimated: services';
  if (text.includes('ecommerce') || text.includes('commerce')) return 'estimated: commerce';
  return 'not found';
}

function inferIndustry(job) {
  const text = `${job.title || ''} ${job.description || ''} ${(job.required_skills || []).join(' ')}`.toLowerCase();
  if (text.includes('fintech') || text.includes('payments') || text.includes('banking')) return 'estimated: fintech';
  if (text.includes('healthcare') || text.includes('medical')) return 'estimated: healthcare';
  if (text.includes('ai') || text.includes('machine learning')) return 'estimated: artificial intelligence';
  if (text.includes('security') || text.includes('infosec')) return 'estimated: cybersecurity';
  if (text.includes('marketing')) return 'estimated: marketing';
  return 'not found';
}

function summarizeHiringIntent(company, allJobs) {
  const jobs = allJobs.filter((job) => company.job_ids.includes(job.job_id));
  if (jobs.length === 0) return 'not found';
  const departments = new Map();
  for (const job of jobs) {
    departments.set(job.department, (departments.get(job.department) || 0) + 1);
  }
  const top = [...departments.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top || top[0] === 'not found') return `Company has ${jobs.length} active public hiring signal(s); direction requires additional enrichment.`;
  return `Company has ${jobs.length} active public hiring signal(s), led by ${top[0]} roles; this suggests current investment in ${top[0].toLowerCase()} capacity.`;
}

function firstCareerUrl(job) {
  if (job.source === 'ashby') return job.source_url?.replace('/posting-api/job-board/', '/').replace(/\?.*$/, '') || job.job_url;
  if (job.source === 'lever') return job.source_url?.replace('https://api.lever.co/v0/postings/', 'https://jobs.lever.co/').replace(/\?.*$/, '') || job.job_url;
  if (job.source === 'greenhouse') return job.source_url?.replace('https://boards-api.greenhouse.io/v1/boards/', 'https://boards.greenhouse.io/').replace('/jobs?content=true', '') || job.job_url;
  return job.job_url;
}

function websiteEvidence(value) {
  return { value, source: 'not_found', source_url: null, confidence: 'none', is_estimated: false, candidate_score: 0, reasons: [] };
}

function employeeRangeNotFound() {
  return { min: null, max: null, label: 'not found', source: 'not_found', source_url: null, confidence: 'none', is_estimated: false, extracted_text: null };
}

function employeeRangeToEvidence(range) {
  if (!range || range.label === 'not found') return makeEvidence('not found', null, 'none', false);
  return makeEvidence(`${range.label} employees`, range.source_url, range.confidence, range.is_estimated);
}
