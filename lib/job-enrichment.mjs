import { canonicalUrl, externalJobKey, jobIdentityFields } from './job-identity.mjs';
import { normalizeText, normalizeWhitespace } from './job-normalizer.mjs';

export function enrichJob(job = {}) {
  const identity = jobIdentityFields(job);
  const text = normalizeText(`${job.title || ''} ${job.location || ''} ${job.work_mode || ''} ${job.description || ''}`);
  const seniority = inferSeniority(text);
  const language = inferApplicationLanguage(job, text);

  return {
    ...job,
    canonical_url: identity.canonical_url || canonicalUrl(job.link || ''),
    external_id: externalJobKey(job),
    fingerprint: identity.fingerprint,
    similar_key: identity.similar_key,
    company_role_key: identity.company_role_key,
    application_language: language,
    seniority,
    date_posted: normalizeWhitespace(job.date_posted || job.datePosted || ''),
    valid_through: normalizeWhitespace(job.valid_through || job.validThrough || ''),
    employment_type: normalizeWhitespace(job.employment_type || job.employmentType || ''),
    apply_url: normalizeWhitespace(job.apply_url || job.application_url || job.link || ''),
    enrichment: {
      canonical_url: identity.canonical_url,
      external_id: externalJobKey(job),
      fingerprint: identity.fingerprint,
      seniority,
      language,
      years_experience: Number(job.asks_years_experience || 0),
      has_stack: Array.isArray(job.stack_required) && job.stack_required.length > 0,
      has_compensation: Boolean(job.compensation && normalizeText(job.compensation) !== 'a confirmar'),
      has_valid_through: Boolean(job.valid_through || job.validThrough),
    },
  };
}

function inferSeniority(text) {
  if (hasAny(text, ['internship', 'intern', 'estagio', 'estagiario', 'trainee'])) return 'internship';
  if (hasAny(text, ['junior', 'entry level', 'graduate', 'recem licenciado'])) return 'junior';
  if (hasAny(text, ['senior', 'staff', 'principal', 'lead'])) return 'senior';
  if (hasAny(text, ['mid level', 'mid-level', 'pleno'])) return 'mid';
  return 'a confirmar';
}

function inferApplicationLanguage(job, text) {
  const source = normalizeText(`${job.company || ''} ${job.location || ''} ${job.link || ''} ${job.source || ''} ${text}`);
  if (hasAny(source, ['portugal', 'lisboa', 'lisbon', 'porto', 'coimbra', 'aveiro', 'braga', '.pt'])) return 'pt';
  return 'en';
}

function hasAny(text, needles) {
  return needles.some((needle) => text.includes(normalizeText(needle)));
}
