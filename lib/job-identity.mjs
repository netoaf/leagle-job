import { createHash } from 'crypto';
import { normalizeText, normalizeWhitespace, slugify } from './job-normalizer.mjs';

const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gh_src',
  'source',
  'ref',
  'referrer',
  'src',
];

const TITLE_NOISE = new Set([
  'm',
  'f',
  'd',
  'x',
  'hibrido',
  'hybrid',
  'remote',
  'remoto',
  'onsite',
  'presencial',
  'lisboa',
  'lisbon',
  'porto',
  'coimbra',
  'aveiro',
  'braga',
  'portugal',
  'pt',
]);

const COMPANY_SUFFIXES = [
  /\bportugal\b/g,
  /\bltd\b/g,
  /\blimited\b/g,
  /\binc\b/g,
  /\bllc\b/g,
  /\bsa\b/g,
  /\bs\.a\.\b/g,
  /\bunipessoal\b/g,
  /\bconsulting\b/g,
];

export function canonicalUrl(value) {
  const raw = normalizeWhitespace(value || '');
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.includes(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hash = '';
    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }
    const clean = parsed.toString().replace(/\/$/, '');
    return clean;
  } catch {
    return raw.replace(/[.,;]+$/, '').replace(/\/$/, '');
  }
}

export function normalizeCompanyName(value) {
  let text = normalizeText(value || '').replace(/&/g, ' and ');
  for (const pattern of COMPANY_SUFFIXES) text = text.replace(pattern, ' ');
  return text.replace(/[^a-z0-9]+/g, ' ').trim();
}

export function normalizeTitle(value) {
  return normalizeText(value || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b(m\/f\/d|m\/f|f\/m|all genders)\b/g, ' ')
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .trim();
}

export function normalizeTitleKey(value) {
  const words = normalizeTitle(value)
    .split(/\s+/)
    .filter((word) => word.length > 1 && !TITLE_NOISE.has(word));
  return words.join(' ');
}

export function normalizeLocationKey(value) {
  const text = normalizeText(value || '');
  const hits = [];
  const locations = [
    ['lisboa', 'lisboa'],
    ['lisbon', 'lisboa'],
    ['porto', 'porto'],
    ['coimbra', 'coimbra'],
    ['aveiro', 'aveiro'],
    ['braga', 'braga'],
    ['remote', 'remote'],
    ['remoto', 'remote'],
    ['portugal', 'portugal'],
    ['germany', 'germany'],
    ['deutschland', 'germany'],
    ['spain', 'spain'],
    ['madrid', 'madrid'],
    ['barcelona', 'barcelona'],
    ['france', 'france'],
    ['paris', 'paris'],
    ['london', 'london'],
    ['uk', 'uk'],
    ['united kingdom', 'uk'],
    ['usa', 'usa'],
    ['united states', 'usa'],
  ];
  for (const [needle, label] of locations) {
    if (text.includes(needle) && !hits.includes(label)) hits.push(label);
  }
  return hits.slice(0, 3).join(' ');
}

export function externalJobKey(job = {}) {
  const url = canonicalUrl(job.link || job.url || '');
  const source = normalizeText(job.source || '');
  const parsed = parseUrl(url);
  if (!parsed) return '';

  const host = parsed.hostname;
  const path = parsed.pathname;

  if (host.includes('itjobs.pt')) {
    const id = path.match(/\/oferta\/(\d+)/i)?.[1];
    if (id) return `itjobs:${id}`;
  }

  if (host.includes('greenhouse.io')) {
    const id = path.match(/\/jobs\/(\d+)/i)?.[1];
    if (id) return `greenhouse:${id}`;
  }

  if (host.includes('ashbyhq.com')) {
    const parts = path.split('/').filter(Boolean);
    if (parts.length >= 2) return `ashby:${parts[0]}:${parts[1]}`;
  }

  if (host.includes('lever.co')) {
    const parts = path.split('/').filter(Boolean);
    if (parts.length >= 2) return `lever:${parts[0]}:${parts.at(-1)}`;
  }

  if (host.includes('myworkdayjobs.com') || host.includes('workdayjobs.com') || source.includes('workday')) {
    const id = `${path} ${parsed.search}`.match(/\b(R\d{3,}|JR\d{3,}|REQ[-_A-Z0-9]+)\b/i)?.[1];
    if (id) return `workday:${id.toUpperCase()}`;
  }

  if (host.includes('smartrecruiters.com')) {
    const id = path.match(/\/(\d{6,})(?:-|\/|$)/)?.[1];
    if (id) return `smartrecruiters:${id}`;
  }

  if (host.includes('remotive.com')) {
    const id = path.match(/-(\d{5,})(?:\/)?$/)?.[1];
    if (id) return `remotive:${id}`;
  }

  if (host.includes('ycombinator.com')) {
    const parts = path.split('/').filter(Boolean);
    const jobsIndex = parts.indexOf('jobs');
    if (jobsIndex >= 0 && parts[jobsIndex + 1]) {
      return `yc:${parts.slice(0, jobsIndex).join('-')}:${parts[jobsIndex + 1]}`;
    }
  }

  return '';
}

export function companyRoleKey(job = {}) {
  const company = normalizeCompanyName(job.company || '');
  const title = normalizeTitleKey(job.title || job.role || '');
  return company && title ? `${company}::${title}` : '';
}

export function similarJobKey(job = {}) {
  const base = companyRoleKey(job);
  if (!base) return '';
  const location = normalizeLocationKey(job.location || job.work_mode || '');
  return location ? `${base}::${location}` : base;
}

export function descriptionHash(value) {
  const text = normalizeText(value || '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 1200);
  if (text.length < 80) return '';
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}

export function jobIdentityFields(job = {}) {
  const canonical_url = canonicalUrl(job.link || job.url || '');
  const external_key = externalJobKey(job);
  const company_role_key = companyRoleKey(job);
  const similar_key = similarJobKey(job);
  const description_hash = descriptionHash(job.description || '');
  const fingerprint = external_key || similar_key || canonical_url || description_hash;

  return {
    canonical_url,
    external_key,
    company_key: normalizeCompanyName(job.company || ''),
    title_key: normalizeTitleKey(job.title || job.role || ''),
    company_role_key,
    similar_key,
    description_hash,
    fingerprint,
  };
}

export function jobFingerprint(job = {}) {
  return jobIdentityFields(job).fingerprint;
}

export function jobIndexRecord(job = {}, extra = {}) {
  const identity = jobIdentityFields(job);
  return {
    fingerprint: identity.fingerprint,
    canonical_url: identity.canonical_url,
    external_key: identity.external_key,
    similar_key: identity.similar_key,
    company_role_key: identity.company_role_key,
    description_hash: identity.description_hash,
    company: normalizeWhitespace(job.company || ''),
    title: normalizeWhitespace(job.title || job.role || ''),
    location: normalizeWhitespace(job.location || ''),
    source: normalizeWhitespace(job.source || ''),
    status: extra.status || job.status || 'seen',
    first_seen: extra.first_seen || job.first_seen || extra.date || '',
    last_seen: extra.last_seen || extra.date || '',
    score: extra.score,
    recommendation: extra.recommendation,
  };
}

export function identitySlug(job = {}) {
  const identity = jobIdentityFields(job);
  return slugify(identity.external_key || identity.similar_key || identity.canonical_url || job.title || 'job');
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
