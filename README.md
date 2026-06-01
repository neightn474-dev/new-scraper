# Hiring Intelligence Scraper

Apify-ready public hiring and company-intelligence scraper for private companies, startups, and public recruitment-style job leads. The system is designed for daily cloud runs with conservative rate limits, source provenance, deduplication, graceful failures, and hard Middle East exclusion.

## What it does

- Scrapes no-key public job sources:
  - Greenhouse public job boards
  - Lever public postings
  - Ashby public job boards
  - RemoteOK public API
  - Arbeitnow public API
  - Hacker News Algolia discovery threads, disabled by default
- Excludes Middle East company/job records before final output.
- Avoids government, exam-based, login-only, paid, and protected sources.
- Normalizes jobs and companies into JSON, CSV, and Markdown.
- Stores source URLs and confidence markers for company fields.
- Writes Apify Dataset records plus Key-Value Store files when run on Apify.
- Writes local output files under `output/latest/` when run locally or in CI.

## Non-goals

This MVP intentionally does **not** scrape LinkedIn, Crunchbase, USAJOBS, government boards, paywalled pages, login-only pages, or protected data. It also does not guess private company revenue; unavailable fields are marked `not found`.

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
  "requestDelayMs": 1500,
  "contactEmail": "ops@example.com"
}
```

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

`examples/output.example.json` documents the output envelope without fabricated records. Run the Actor to generate live records from public endpoints.

## Middle East exclusion

The strict default exclusion list lives in `config/region_exclusions.json`. Records are excluded if company, job, location, description, or URL fields contain configured country/city signals.

## Reliability behavior

- Per-host request delay defaults to 1500 ms.
- GET requests retry transient failures with bounded backoff.
- One failed source does not fail the full run.
- The run manifest records failures, counts, exclusions, deduplication, and validation status.

## Adding a new source

1. Add an adapter under `src/adapters/`.
2. Return normalized job records with `source`, `source_url`, `company_name`, `title`, `location`, and `job_url`.
3. Add the adapter to `src/main.js`.
4. Ensure Middle East filtering runs before final output.
5. Add source-specific terms/rate-limit notes to this README.
