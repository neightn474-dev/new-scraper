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
- Stores source URLs and confidence markers for company fields.
- Writes Apify Dataset records plus Key-Value Store files when run on Apify.
- Writes local output files under `output/latest/` when run locally or in CI.

## Non-goals

This MVP intentionally does **not** scrape LinkedIn, Crunchbase, USAJOBS, government boards, paywalled pages, login-only pages, protected data, or Google result pages. It also does not guess private company revenue or employee count; unavailable fields are marked `not found` and weak employee-size evidence can be filtered out with `minimumConfidence`.

## Quick start

```bash
npm install
npm run scrape
