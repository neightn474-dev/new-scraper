import { canonicalCompanyName, canonicalDomain, makeEvidence, normalizeWhitespace, stableHash } from '../lib/normalize.js';

export function buildCompaniesFromJobs(jobs) {
  const companies = new Map();
  for (const job of jobs) {
    const domain = canonicalDomain(job.job_url);
    const companyKey = domain || canonicalCompanyName(job.company_name) || stableHash(job.company_name);
    if (!companies.has(companyKey)) {
      companies.set(companyKey, {
        company_id: companyKey,
        name: makeEvidence(displayCompanyName(job.company_name), job.job_url, 'medium', false),
        website: makeEvidence(domain ? `https://${domain}` : 'not found', job.job_url, domain ? 'medium' : 'none', false),
        linkedin_url: makeEvidence('not found', null, 'none', false),
        ceo_or_founder: makeEvidence('not found', null, 'none', false),
        business_model: makeEvidence(inferBusinessModel(job), job.job_url, inferBusinessModel(job) === 'not found' ? 'none' : 'low', inferBusinessModel(job) !== 'not found'),
        main_product_or_service: makeEvidence('not found', null, 'none', false),
        revenue_streams: makeEvidence('not found', null, 'none', false),
        estimated_revenue: makeEvidence('not found', null, 'none', false),
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

export async function enrichCompanies(companies, _http, _options = {}) {
  // MVP keeps enrichment conservative and non-blocking. Additional website/Wikidata/GDELT enrichers can be added here.
  return companies;
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
