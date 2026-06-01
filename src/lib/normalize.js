export function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function stripHtml(html) {
  return normalizeWhitespace(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
}

export function canonicalDomain(urlOrText) {
  if (!urlOrText) return null;
  try {
    const url = new URL(urlOrText.startsWith('http') ? urlOrText : `https://${urlOrText}`);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

export function canonicalCompanyName(name) {
  return normalizeWhitespace(name).replace(/\b(inc|inc\.|llc|ltd|ltd\.|gmbh|corp|corp\.|corporation|co\.|company)\b/gi, '').toLowerCase();
}

export function inferDepartment(text) {
  const haystack = String(text || '').toLowerCase();
  const rules = [
    ['Engineering', ['engineer', 'developer', 'software', 'platform', 'infrastructure', 'devops', 'sre']],
    ['Sales', ['account executive', 'sales', 'business development', 'bdr', 'sdr']],
    ['Marketing', ['marketing', 'growth', 'content', 'brand', 'demand generation']],
    ['Product', ['product manager', 'product designer', 'product']],
    ['Finance', ['finance', 'accounting', 'controller', 'fp&a', 'bookkeeper']],
    ['Operations', ['operations', 'ops', 'chief of staff']],
    ['Customer Success', ['customer success', 'support', 'implementation', 'solutions engineer']],
    ['People', ['recruiter', 'talent', 'people', 'hr']]
  ];
  for (const [department, needles] of rules) {
    if (needles.some((needle) => haystack.includes(needle))) return department;
  }
  return 'not found';
}

export function inferExperienceLevel(text) {
  const haystack = String(text || '').toLowerCase();
  if (/\b(intern|internship|graduate|entry level|junior)\b/.test(haystack)) return 'entry';
  if (/\b(senior|staff|principal|lead|head of|director|vp|chief)\b/.test(haystack)) return 'senior';
  if (/\b(manager|mid-level|mid level|3\+ years|4\+ years|5\+ years)\b/.test(haystack)) return 'mid';
  return 'not found';
}

export function extractSkills(text) {
  const haystack = String(text || '').toLowerCase();
  const skills = [
    'JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust', 'Ruby', 'React', 'Node.js',
    'SQL', 'PostgreSQL', 'MySQL', 'AWS', 'GCP', 'Azure', 'Kubernetes', 'Docker', 'Terraform',
    'Linux', 'Salesforce', 'HubSpot', 'Excel', 'PowerBI', 'GAAP', 'SEO', 'Google Ads', 'Meta Ads'
  ];
  return skills.filter((skill) => haystack.includes(skill.toLowerCase())).slice(0, 20);
}

export function stableHash(input) {
  let hash = 0;
  const text = String(input || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function makeEvidence(value, sourceUrl, confidence = 'medium', isEstimated = false) {
  return { value: value || 'not found', source_url: sourceUrl || null, confidence, is_estimated: isEstimated };
}
