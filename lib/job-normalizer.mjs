const UNKNOWN = 'a confirmar';

const TECH_TERMS = [
  'C#',
  '.NET',
  'JavaScript',
  'TypeScript',
  'HTML',
  'CSS',
  'React',
  'Next.js',
  'Node.js',
  'Express',
  'SQL',
  'PostgreSQL',
  'SQL Server',
  'Python',
  'Java',
  'PHP',
  'Laravel',
  'Symfony',
  'Angular',
  'Vue',
  'Docker',
  'Kubernetes',
  'Azure',
  'AWS',
  'GCP',
  'Git',
  'GitHub',
  'REST API',
  'GraphQL',
  'Postman',
  'Swagger',
  'Power BI',
  'ServiceNow',
  'OpenAI',
  'RAG',
  'LLM',
  'Machine Learning',
  'AI',
];

const LOCATION_TERMS = [
  'Lisboa',
  'Lisbon',
  'Porto',
  'Coimbra',
  'Aveiro',
  'Braga',
  'Portugal',
  'Remote',
  'Remoto',
  'Hybrid',
  'Hibrido',
  'Onsite',
  'Presencial',
];

export function normalizeJob(raw = {}) {
  const description = normalizeWhitespace(stripHtml(raw.description || raw.content || raw.summary || ''));
  const text = `${raw.title || ''} ${raw.company || ''} ${raw.location || ''} ${description}`;
  const stack = asArray(raw.stack_required).length > 0
    ? unique(asArray(raw.stack_required).map(String).filter(Boolean))
    : extractStack(text);

  return {
    title: cleanTitle(raw.title || UNKNOWN),
    company: normalizeWhitespace(decodeHtml(raw.company || UNKNOWN)),
    location: normalizeWhitespace(raw.location || inferLocation(text)),
    work_mode: normalizeWhitespace(raw.work_mode || inferWorkMode(text)),
    link: normalizeWhitespace(raw.link || raw.url || ''),
    description,
    stack_required: stack,
    compensation: normalizeWhitespace(raw.compensation || inferCompensation(text)),
    mentorship: raw.mentorship ?? inferMentorship(text),
    progression: raw.progression ?? inferProgression(text),
    asks_years_experience: raw.asks_years_experience ?? extractYearsExperience(text),
    source: normalizeWhitespace(raw.source || UNKNOWN),
    first_seen: raw.first_seen || todayISO(),
    is_active: raw.is_active ?? !isExpiredText(text, raw.link || raw.url || ''),
    date_posted: normalizeWhitespace(raw.date_posted || raw.datePosted || ''),
    valid_through: normalizeWhitespace(raw.valid_through || raw.validThrough || ''),
    employment_type: normalizeWhitespace(raw.employment_type || raw.employmentType || ''),
    apply_url: normalizeWhitespace(raw.apply_url || raw.application_url || raw.applicationUrl || raw.link || raw.url || ''),
  };
}

export function extractStack(value) {
  const source = String(value ?? '');
  const found = [];

  for (const tech of TECH_TERMS) {
    if (techMatches(source, tech)) found.push(tech);
  }

  return unique(found);
}

export function inferWorkMode(value) {
  const text = normalizeText(value);
  if (hasAny(text, ['remote', 'remoto', 'remote-first', 'fully remote'])) return 'Remote';
  if (hasAny(text, ['hybrid', 'hibrido', 'hibrido', 'part remote'])) return 'Hybrid';
  if (hasAny(text, ['onsite', 'on-site', 'presencial', 'no escritorio'])) return 'Onsite';
  return UNKNOWN;
}

export function inferLocation(value) {
  const text = normalizeText(value);
  const found = LOCATION_TERMS.filter((location) => text.includes(normalizeText(location)));
  if (found.length === 0) return UNKNOWN;
  return unique(found).slice(0, 3).join(' / ');
}

export function inferCompensation(value) {
  const text = normalizeText(value);
  if (hasAny(text, ['paid internship', 'estagio remunerado', 'bolsa', 'stipend', 'salary', 'salario', 'remunerado', 'remuneracao', 'vencimento'])) return 'a confirmar: sinal de remuneracao/bolsa mencionado';
  if (hasAny(text, ['unpaid', 'nao remunerado', 'sem remuneracao'])) return 'unpaid';
  return UNKNOWN;
}

export function inferMentorship(value) {
  const text = normalizeText(value);
  if (hasAny(text, ['mentoria', 'mentor', 'mentorship', 'acompanhamento', 'training', 'formacao', 'learn with', 'aprender com'])) return true;
  if (hasAny(text, ['no mentorship', 'sem mentoria', 'autonomous from day one'])) return false;
  return UNKNOWN;
}

export function inferProgression(value) {
  const text = normalizeText(value);
  if (hasAny(text, ['progression', 'progressao', 'contrato', 'integration', 'integracao', 'career path', 'crescimento', 'evolucao'])) return true;
  return UNKNOWN;
}

export function extractYearsExperience(value) {
  const text = normalizeText(value);
  const matches = [...text.matchAll(/(\d+)\+?\s*(years|anos|year|ano)/g)].map((match) => Number(match[1]));
  return matches.length > 0 ? Math.max(...matches) : 0;
}

export function isExpiredText(value, url = '') {
  const text = normalizeText(`${value} ${url}`);
  return hasAny(text, [
    'anuncio inativo',
    'anuncio inactivo',
    'oferta inativa',
    'oferta inactiva',
    'expired',
    'no longer accepting applications',
    'position has been filled',
    'job not found',
    '404',
  ]);
}

export function extractAnchors(html, baseUrl) {
  const anchors = [];
  const pattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = pattern.exec(html))) {
    const href = absolutizeUrl(decodeHtml(match[1]), baseUrl);
    const text = normalizeWhitespace(stripHtml(match[2]));
    if (!href || !text) continue;
    anchors.push({ href, text });
  }

  return anchors;
}

export function stripHtml(value) {
  const decoded = decodeHtml(String(value ?? ''));
  return decodeHtml(decoded
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '));
}

export function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)));
}

export function normalizeWhitespace(value) {
  return repairUtf8Mojibake(String(value ?? '')).replace(/\s+/g, ' ').trim();
}

export function normalizeText(value) {
  return repairUtf8Mojibake(String(value ?? ''))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// Some Portuguese job boards return UTF-8 bytes decoded as Windows-1252.
// Repair only strings that contain the characteristic byte-sequence markers;
// valid Portuguese text such as "SÃO" is left untouched.
export function repairUtf8Mojibake(value) {
  const source = String(value ?? '');
  if (!/(?:Ã[\u0080-\u00bf]|Â[\u0080-\u00bf]|â[\u0080-\u20ac])/.test(source)) return source;

  const cp1252 = new Map([
    [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
    [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
    [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
    [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
    [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
    [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
    [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
  ]);

  const bytes = [];
  for (const character of source) {
    const code = character.codePointAt(0);
    if (code <= 0xff) bytes.push(code);
    else if (cp1252.has(code)) bytes.push(cp1252.get(code));
    else return source;
  }

  const repaired = Buffer.from(bytes).toString('utf8');
  if (repaired.includes('\uFFFD')) return source;

  const suspicious = (text) => (text.match(/(?:Ã[\u0080-\u00bf]|Â[\u0080-\u00bf]|â[\u0080-\u20ac])/g) || []).length;
  return suspicious(repaired) < suspicious(source) ? repaired : source;
}

export function slugify(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'job';
}

export function jobIdentity(job) {
  return normalizeText(`${job.company || ''}|${job.title || ''}|${job.link || ''}`)
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanTitle(value) {
  return normalizeWhitespace(decodeHtml(value))
    .replace(/\s+-\s+Apply.*$/i, '')
    .replace(/\s+\|\s+.*$/i, '')
    .replace(/^Jobs?\s*[-:]\s*/i, '')
    .slice(0, 160);
}

export function todayISO(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function normalizeTech(value) {
  return normalizeText(value).replace(/[^a-z0-9+#.]/g, '');
}

function techMatches(source, tech) {
  const text = normalizeText(source);
  const normalized = normalizeText(tech);

  if (tech === 'AI') return /\b(ai|artificial intelligence|inteligencia artificial)\b/i.test(text);
  if (tech === 'C#') return /(^|[^a-z0-9])c#([^a-z0-9]|$)/i.test(text);
  if (tech === '.NET') return /(^|[^a-z0-9])(\.net|dotnet)([^a-z0-9]|$)/i.test(text);
  if (tech === 'Node.js') return /(^|[^a-z0-9])(node\.js|nodejs)([^a-z0-9]|$)/i.test(text);
  if (tech === 'Next.js') return /(^|[^a-z0-9])(next\.js|nextjs)([^a-z0-9]|$)/i.test(text);
  if (tech === 'REST API') return /\b(rest api|restful api|apis? rest)\b/i.test(text);
  if (tech === 'SQL') return /\bsql\b/i.test(text);
  if (tech === 'RAG') return /\brag\b/i.test(text);
  if (tech === 'LLM') return /\bllm(s)?\b/i.test(text);

  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#.]|$)`, 'i').test(text);
}

function hasAny(text, needles) {
  const source = normalizeText(text);
  return needles.some((needle) => source.includes(normalizeText(needle)));
}

function absolutizeUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return '';
  }
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
