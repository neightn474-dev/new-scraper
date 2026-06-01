import { getActorRuntime } from './lib/apify-runtime.js';
import { scrapeCareerUrl } from './adapters/ats.js';
import { scrapeArbeitnow, scrapeHackerNews, scrapeRemoteOk } from './adapters/discovery.js';
import { enrichCompanies, buildCompaniesFromJobs } from './enrichment/company.js';
import { hasMiddleEastSignal, loadMiddleEastTerms } from './filters/middle-east.js';
import { writeApifyOutputs, writeLocalOutputs } from './io/exporters.js';
import { HttpClient } from './lib/http.js';
import { canonicalCompanyName, stableHash } from './lib/normalize.js';

const DEFAULT_INPUT = {
  careerPageUrls: [],
  discoverySources: {
    remoteok: true,
    arbeitnow: true,
    hackerNews: false,
  },
  excludeMiddleEast: true,
  maxJobsPerSource: 100,
  requestDelayMs: 1500,
  contactEmail: '',
};

const Actor = await getActorRuntime();
await Actor.init();
try {
  const actorInput = (await Actor.getInput()) || {};
  const input = normalizeInput({ ...DEFAULT_INPUT, ...actorInput });
  const run = await runScraper(input);
  await writeLocalOutputs(run);
  await writeApifyOutputs(Actor, run);
  console.log(JSON.stringify(run.manifest, null, 2));
} finally {
  await Actor.exit();
}

export async function runScraper(input) {
  const startedAt = new Date().toISOString();
  const manifest = {
    run_id: `run_${startedAt.replace(/[:.]/g, '-')}`,
    started_at: startedAt,
    status: 'running',
    input_summary: {
      career_page_urls: input.careerPageUrls.length,
      discovery_sources: input.discoverySources,
      exclude_middle_east: input.excludeMiddleEast,
      max_jobs_per_source: input.maxJobsPerSource,
    },
    sources: {},
    failures: [],
    excluded_middle_east_count: 0,
    deduped_count: 0,
    validation: {},
  };

  const userAgent = `hiring-intel-scraper/0.1${input.contactEmail ? ` contact:${input.contactEmail}` : ''}`;
  const http = new HttpClient({ userAgent, requestDelayMs: input.requestDelayMs });
  const middleEastTerms = input.excludeMiddleEast ? await loadMiddleEastTerms() : [];

  const allJobs = [];
  const adapters = [];
  for (const url of input.careerPageUrls) {
    adapters.push({ name: `career:${url}`, run: () => scrapeCareerUrl(url, http, input) });
  }
  if (input.discoverySources.remoteok) adapters.push({ name: 'remoteok', run: () => scrapeRemoteOk(http, input) });
  if (input.discoverySources.arbeitnow) adapters.push({ name: 'arbeitnow', run: () => scrapeArbeitnow(http, input) });
  if (input.discoverySources.hackerNews) adapters.push({ name: 'hacker_news_algolia', run: () => scrapeHackerNews(http, input) });

  for (const adapter of adapters) {
    try {
      const result = await adapter.run();
      manifest.sources[adapter.name] = {
        status: result.status,
        source: result.source,
        jobs_seen: result.jobs.length,
      };
      allJobs.push(...result.jobs);
    } catch (error) {
      manifest.sources[adapter.name] = { status: 'failed', error: error.message };
      manifest.failures.push({ source: adapter.name, error: error.message });
    }
  }

  const regionFilteredJobs = [];
  for (const job of allJobs) {
    const regionCheck = input.excludeMiddleEast ? hasMiddleEastSignal(job, middleEastTerms) : { excluded: false, matchedTerms: [] };
    if (regionCheck.excluded) {
      manifest.excluded_middle_east_count += 1;
      continue;
    }
    regionFilteredJobs.push({ ...job, excluded_region_check: { middle_east_match: false, checked: input.excludeMiddleEast } });
  }

  const { jobs, dedupedCount } = dedupeJobs(regionFilteredJobs);
  manifest.deduped_count = dedupedCount;

  const companies = await enrichCompanies(buildCompaniesFromJobs(jobs), http, input);
  validateOutputs({ jobs, companies, manifest });
  manifest.finished_at = new Date().toISOString();
  manifest.status = manifest.failures.length ? 'success_with_warnings' : 'success';
  manifest.output_counts = { jobs: jobs.length, companies: companies.length };

  return { jobs, companies, manifest };
}

function normalizeInput(input) {
  return {
    ...input,
    careerPageUrls: Array.isArray(input.careerPageUrls) ? input.careerPageUrls.filter(Boolean) : [],
    discoverySources: { ...DEFAULT_INPUT.discoverySources, ...(input.discoverySources || {}) },
    excludeMiddleEast: input.excludeMiddleEast !== false,
    maxJobsPerSource: Number(input.maxJobsPerSource) > 0 ? Number(input.maxJobsPerSource) : DEFAULT_INPUT.maxJobsPerSource,
    requestDelayMs: Number(input.requestDelayMs) >= 250 ? Number(input.requestDelayMs) : DEFAULT_INPUT.requestDelayMs,
  };
}

function dedupeJobs(jobs) {
  const seen = new Set();
  const output = [];
  let dedupedCount = 0;
  for (const job of jobs) {
    const key = job.job_id || job.job_url || `${canonicalCompanyName(job.company_name)}:${canonicalCompanyName(job.title)}:${canonicalCompanyName(job.location)}` || stableHash(JSON.stringify(job));
    if (seen.has(key)) {
      dedupedCount += 1;
      continue;
    }
    seen.add(key);
    output.push(job);
  }
  return { jobs: output, dedupedCount };
}

function validateOutputs({ jobs, companies, manifest }) {
  const issues = [];
  for (const job of jobs) {
    if (!job.title || job.title === 'not found') issues.push(`Missing title for ${job.job_id}`);
    if (!job.company_name || job.company_name === 'not found') issues.push(`Missing company for ${job.job_id}`);
    if (!job.source_url) issues.push(`Missing source_url for ${job.job_id}`);
  }
  for (const company of companies) {
    if (!company.name?.value || company.name.value === 'not found') issues.push(`Missing company name for ${company.company_id}`);
  }
  manifest.validation = { status: issues.length ? 'warning' : 'passed', issues: issues.slice(0, 50) };
}
