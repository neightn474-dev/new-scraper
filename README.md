# Hiring Intelligence Scraper

Apify-ready public hiring and company-intelligence scraper for private companies, startups, and public recruitment-style job leads. The system is designed for daily cloud runs with conservative rate limits, source provenance, deduplication, graceful failures, automatic website/employee-range enrichment, and hard Middle East exclusion.

## What it does

- Scrapes no-key public job sources:
  - Greenhouse public job boards
  - Lever public postings
  - Ashby public job boards
  - RemoteOK public API
  - Arbeitnow public API
  - Hacker News Algolia discovery threads, disabled by default
- Automatically resolves company website URLs from career page links, job-description URLs, and Wikidata.
- Automatically discovers employee ranges from verified public company pages and Wikidata, with source URLs and confidence labels.
- Filters companies by employee range when enabled; unknown sizes are excluded by default when the filter is active.
- Excludes Middle East company/job records before final output.
- Avoids government, exam-based, login-only, paid, protected, and direct Google-scraped sources.
- Normalizes jobs and companies into JSON, CSV, and Markdown.
- Writes Apify Dataset records plus Key-Value Store files when run on Apify.
- Writes local output files under `output/latest/` when run locally or in CI.

## Non-goals

This MVP intentionally does **not** scrape LinkedIn, Crunchbase, USAJOBS, government boards, paywalled pages, login-only pages, protected data, or Google result pages. It also does not guess private company revenue or employee count; unavailable fields are marked `not found` and weak employee-size evidence can be filtered out with `minimumConfidence`.

## Quick start

```bash
npm install
npm run scrape
```

Use the example input as a starting point:

```bash
cp examples/input.example.json INPUT.json
```

When running outside Apify, pass input through `APIFY_INPUT` compatible storage or update the default input in Apify. On Apify, paste the JSON from `examples/input.example.json` into the Actor input editor.

## Apify deployment

This repository is an Apify Actor project:

- `.actor/actor.json` defines actor metadata.
- `.actor/input_schema.json` defines cloud input fields.
- `Dockerfile` builds the runtime image.
- `src/main.js` is the Actor entrypoint.

Deploy with:

```bash
APIFY_TOKEN=your_token npx apify-cli push
```

The Actor writes:

- Dataset items with `record_type: "job"` or `record_type: "company"`
- Key-value store files:
  - `jobs.json`
  - `companies.json`
  - `jobs.csv`
  - `companies.csv`
  - `report.md`
  - `run_manifest.json`

## Input

```json
{
  "careerPageUrls": [
    "https://jobs.ashbyhq.com/anthropic",
    "https://jobs.lever.co/netlify",
    "https://boards.greenhouse.io/stripe"
  ],
  "discoverySources": {
    "remoteok": true,
    "arbeitnow": true,
    "hackerNews": false
  },
  "excludeMiddleEast": true,
  "maxJobsPerSource": 100,
  "maxCompaniesToEnrich": 50,
  "requestDelayMs": 1500,
  "contactEmail": "ops@example.com",
  "respectRobotsTxt": true,
  "employeeRangeFilter": {
    "enabled": true,
    "minEmployees": 50,
    "maxEmployees": 100,
    "matchMode": "overlap",
    "unknownCompanySizePolicy": "exclude",
    "minimumConfidence": "medium"
  },
  "websiteDiscovery": {
    "enabled": true,
    "fetchCareerPageLinks": true,
    "fetchJobDescriptionLinks": true,
    "useWikidata": true
  },
  "employeeRangeDiscovery": {
    "enabled": true,
    "useCompanyWebsite": true,
    "useWikidata": true,
    "maxPagesPerCompany": 4
  }
}
```

## Website URL enrichment

The scraper resolves `website_url` automatically and never uses job-board domains such as `jobs.ashbyhq.com`, `boards.greenhouse.io`, `jobs.lever.co`, `remoteok.com`, or `arbeitnow.com` as the company website. Candidate website URLs are collected from job descriptions, public career-page outbound links, and Wikidata official website data. Each accepted URL includes source, source URL, confidence, score, and reasons.

## Employee range enrichment and filtering

Employee ranges are extracted from public evidence such as company website/about/team pages and Wikidata employee-count data. The scraper recognizes ranges like `51-100 employees`, `team of 18`, and `50+ people`, normalizes them to `employee_range.min/max/label`, and stores `source_url`, `confidence`, and extracted text.

When `employeeRangeFilter.enabled` is true, companies are included only if the employee range matches the requested range and meets `minimumConfidence`. Unknown employee ranges are excluded by default.

## Output files

Local runs write to `output/latest/`:

```text
companies.json
jobs.json
companies.csv
jobs.csv
report.md
run_manifest.json
```

Company rows include `website_url`, `website_url_source`, `employee_min`, `employee_max`, `employee_range_label`, `employee_range_source`, and `employee_range_confidence`. Job rows include `company_website_url` and company employee-range fields.

## Middle East exclusion

The strict default exclusion list lives in `config/region_exclusions.json`. Records are excluded if company, job, location, description, or URL fields contain configured country/city signals.

## Reliability behavior

- Per-host request delay defaults to 1500 ms.
- GET requests retry transient failures with bounded backoff.
- Company and career HTML enrichment respects robots.txt by default through `respectRobotsTxt`.
- One failed source or enrichment page does not fail the full run.
- The run manifest records failures, counts, exclusions, employee-range exclusions, deduplication, and validation status.

## Adding a new source

1. Add an adapter under `src/adapters/`.
2. Return normalized job records with `source`, `source_url`, `company_name`, `title`, `location`, and `job_url`.
3. Add the adapter to `src/main.js`.
4. Ensure Middle East filtering runs before final output.
5. Add source-specific terms/rate-limit notes to this README.
