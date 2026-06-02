import fs from 'node:fs/promises';

export async function writeLocalOutputs({ jobs, companies, manifest }, outputDir = 'output/latest') {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(`${outputDir}/jobs.json`, `${JSON.stringify(jobs, null, 2)}\n`);
  await fs.writeFile(`${outputDir}/companies.json`, `${JSON.stringify(companies, null, 2)}\n`);
  await fs.writeFile(`${outputDir}/run_manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(`${outputDir}/jobs.csv`, toCsv(jobs));
  await fs.writeFile(`${outputDir}/companies.csv`, toCsv(companies.map(flattenCompany)));
  await fs.writeFile(`${outputDir}/report.md`, toMarkdownReport({ jobs, companies, manifest }));
}

export async function writeApifyOutputs(actor, { jobs, companies, manifest }) {
  if (!actor) return;
  for (const job of jobs) await actor.pushData({ record_type: 'job', ...job });
  for (const company of companies) await actor.pushData({ record_type: 'company', ...company });
  await actor.setValue('jobs.json', jobs, { contentType: 'application/json' });
  await actor.setValue('companies.json', companies, { contentType: 'application/json' });
  await actor.setValue('run_manifest.json', manifest, { contentType: 'application/json' });
  await actor.setValue('jobs.csv', toCsv(jobs), { contentType: 'text/csv' });
  await actor.setValue('companies.csv', toCsv(companies.map(flattenCompany)), { contentType: 'text/csv' });
  await actor.setValue('report.md', toMarkdownReport({ jobs, companies, manifest }), { contentType: 'text/markdown' });
}

export function toCsv(rows) {
  if (!rows.length) return '';
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((key) => csvCell(row[key])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function csvCell(value) {
  if (value == null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function flattenCompany(company) {
  return {
    company_id: company.company_id,
    name: company.name?.value,
    website: company.website?.value,
    website_url: company.website_url?.value,
    website_url_source: company.website_url?.source,
    website_url_confidence: company.website_url?.confidence,
    careers_url: company.careers_url?.value,
    employee_min: company.employee_range?.min,
    employee_max: company.employee_range?.max,
    employee_range_label: company.employee_range?.label,
    employee_range_source: company.employee_range?.source,
    employee_range_confidence: company.employee_range?.confidence,
    employee_range_source_url: company.employee_range?.source_url,
    business_model: company.business_model?.value,
    industry: company.industry?.value,
    location: company.location?.value,
    hiring_intent_summary: company.hiring_intent_summary?.value,
    job_count: company.job_ids?.length || 0,
  };
}

function toMarkdownReport({ jobs, companies, manifest }) {
  const lines = [
    '# Hiring Intelligence Report',
    '',
    `Generated at: ${manifest.finished_at || manifest.started_at}`,
    `Status: ${manifest.status}`,
    '',
    '## Summary',
    '',
    `- Companies: ${companies.length}`,
    `- Jobs: ${jobs.length}`,
    `- Middle East records excluded: ${manifest.excluded_middle_east_count}`,
    '',
    '## Top Companies',
    '',
    '| Company | Jobs | Website | Employees | Industry | Hiring intent |',
    '|---|---:|---|---|---|---|',
  ];
  for (const company of companies.slice(0, 50)) {
    lines.push(`| ${escapeMd(company.name?.value)} | ${company.job_ids?.length || 0} | ${escapeMd(company.website_url?.value)} | ${escapeMd(company.employee_range?.label)} | ${escapeMd(company.industry?.value)} | ${escapeMd(company.hiring_intent_summary?.value)} |`);
  }
  lines.push('', '## Recent Jobs', '', '| Company | Website | Employees | Title | Location | Source | URL |', '|---|---|---|---|---|---|---|');
  for (const job of jobs.slice(0, 100)) {
    lines.push(`| ${escapeMd(job.company_name)} | ${escapeMd(job.company_website_url)} | ${escapeMd(job.company_employee_range_label)} | ${escapeMd(job.title)} | ${escapeMd(job.location)} | ${escapeMd(job.source)} | ${job.job_url} |`);
  }
  return `${lines.join('\n')}\n`;
}

function escapeMd(value) {
  return String(value || 'not found').replace(/\|/g, '\\|');
}
