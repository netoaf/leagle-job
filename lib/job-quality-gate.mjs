import { existsSync } from 'fs';
import { join } from 'path';
import { loadYamlFile } from './config-loader.mjs';
import { normalizeText } from './job-normalizer.mjs';

export const DEFAULT_QUALITY_GATE = {
  required: ['title', 'company', 'link', 'description', 'location_or_remote', 'source'],
  minimums: {
    description_chars: 180,
    quality_score_to_rank: 55,
    quality_score_to_dashboard: 65,
  },
  reject_if: [
    'missing_company',
    'missing_title',
    'missing_link',
    'inactive_or_expired',
    'no_description',
    'scam_or_mlm',
    'non_technical_role',
    'missing_junior_or_mentorship_signal',
    'experience_heavy_without_junior_signal',
  ],
  warn_if: [
    'missing_location',
    'missing_work_mode',
    'missing_compensation',
    'unclear_seniority',
    'possible_senior_role',
  ],
};

export function loadQualityGateConfig(root) {
  const file = join(root, 'config', 'quality-gate.yml');
  if (!existsSync(file)) return DEFAULT_QUALITY_GATE;
  return mergeQualityConfig(DEFAULT_QUALITY_GATE, loadYamlFile(file));
}

export function evaluateJobQuality(job, config = DEFAULT_QUALITY_GATE) {
  const missingFields = missingRequiredFields(job, config.required || []);
  const rejectionReasons = [];
  const warnings = [];
  const text = normalizeText(`${job.title || ''} ${job.company || ''} ${job.location || ''} ${job.work_mode || ''} ${job.description || ''}`);
  const titleText = normalizeText(job.title || '');
  const descriptionText = normalizeText(job.description || '');
  const descriptionLength = String(job.description || '').trim().length;

  for (const field of missingFields) {
    if (field === 'description') rejectionReasons.push('no_description');
    else rejectionReasons.push(`missing_${field}`);
  }

  if (job.is_active === false) rejectionReasons.push('inactive_or_expired');
  if (descriptionLength > 0 && descriptionLength < Number(config.minimums?.description_chars || 0)) {
    warnings.push('thin_description');
  }
  if (!hasUsefulLocation(job)) warnings.push('missing_location');
  if (!job.work_mode || normalizeText(job.work_mode) === 'a confirmar') warnings.push('missing_work_mode');
  if (!job.compensation || normalizeText(job.compensation) === 'a confirmar') warnings.push('missing_compensation');
  if (isScamLike(text)) rejectionReasons.push('scam_or_mlm');
  if (isNonTechnical(text)) rejectionReasons.push('non_technical_role');
  if (isGenericTechnicalRoleWithoutJuniorSignal(titleText, descriptionText)) rejectionReasons.push('missing_junior_or_mentorship_signal');
  if (isExperienceHeavyWithoutJuniorSignal(titleText, descriptionText)) rejectionReasons.push('experience_heavy_without_junior_signal');
  if (isSeniorLike(text)) warnings.push('possible_senior_role');
  if (!hasSenioritySignal(text)) warnings.push('unclear_seniority');

  const blocked = new Set(config.reject_if || []);
  const hardRejected = [...new Set(rejectionReasons)].filter((reason) => blocked.has(reason));
  const qualityScore = qualityScoreFor(job, missingFields, hardRejected, warnings, descriptionLength, config);

  if (qualityScore < Number(config.minimums?.quality_score_to_rank || 0)) {
    hardRejected.push('quality_score_below_rank_minimum');
  }

  return {
    passed: hardRejected.length === 0,
    quality_score: qualityScore,
    missing_fields: [...new Set(missingFields)],
    rejection_reasons: [...new Set(hardRejected)],
    warnings: [...new Set(warnings)],
    description_chars: descriptionLength,
  };
}

function missingRequiredFields(job, required) {
  const missing = [];
  for (const field of required) {
    if (field === 'location_or_remote') {
      if (!hasUsefulLocation(job) && !hasUsefulWorkMode(job)) missing.push('location_or_remote');
      continue;
    }
    const value = job[field];
    if (!value || normalizeText(value) === 'a confirmar') missing.push(field);
  }
  return missing;
}

function qualityScoreFor(job, missingFields, hardRejected, warnings, descriptionLength, config) {
  let score = 100;
  score -= missingFields.length * 16;
  score -= hardRejected.length * 35;
  score -= warnings.length * 5;

  const descriptionMin = Number(config.minimums?.description_chars || 0);
  if (descriptionLength > 0 && descriptionLength < descriptionMin) score -= 12;
  if (hasUsefulLocation(job) || hasUsefulWorkMode(job)) score += 4;
  if (Array.isArray(job.stack_required) && job.stack_required.length > 0) score += 4;
  if (job.asks_years_experience && Number(job.asks_years_experience) > 3) score -= 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function hasUsefulLocation(job) {
  return Boolean(job.location && normalizeText(job.location) !== 'a confirmar');
}

function hasUsefulWorkMode(job) {
  return Boolean(job.work_mode && normalizeText(job.work_mode) !== 'a confirmar');
}

function isScamLike(text) {
  return hasAny(text, ['mlm', 'forex', 'crypto trading', 'ganhos ilimitados', 'unlimited earnings', 'commission only', 'comissoes apenas']);
}

function isNonTechnical(text) {
  const technical = hasAny(text, ['developer', 'engineer', 'programador', 'software', 'frontend', 'backend', 'full stack', 'qa', 'tester', 'data', 'python', 'javascript', 'sql', 'ai', 'automation']);
  const nonTechnical = hasAny(text, ['sales representative', 'account executive', 'telemarketing', 'door to door', 'porta a porta', 'marketing specialist']);
  return nonTechnical && !technical;
}

function isSeniorLike(text) {
  return hasAny(text, ['staff', 'principal', 'lead engineer', 'senior profile', 'perfil senior', 'senior-level', 'mid/senior'])
    || /\b[4-9]\+?\s*(years|anos)\b/.test(text);
}

function hasSenioritySignal(text) {
  return hasAny(text, ['junior', 'estagio', 'estagiario', 'intern', 'internship', 'trainee', 'graduate', 'entry level', 'recem licenciado', 'senior', 'mid', 'pleno']);
}

function isExperienceHeavyWithoutJuniorSignal(titleText, descriptionText) {
  const juniorSignal = hasJuniorOrMentorshipSignal(titleText, descriptionText);
  if (juniorSignal) return false;

  const text = `${titleText} ${descriptionText}`;
  const heavyExperience = hasAny(text, [
    'proven experience',
    'solid experience',
    'strong experience',
    'experiencia comprovada',
    'experiencia solida',
    'forte experiencia',
    'licenciatura',
    'mestrado',
    'bachelor',
    'master',
    'degree',
    'computer science or similar',
    'engenharia informatica ou similar',
  ]);
  return heavyExperience || /\b[2-9]\+?\s*(years|anos)\b/.test(text);
}

function isGenericTechnicalRoleWithoutJuniorSignal(titleText, descriptionText) {
  const text = `${titleText} ${descriptionText}`;
  const technicalRole = hasAny(text, [
    'developer',
    'engineer',
    'programador',
    'software',
    'frontend',
    'backend',
    'fullstack',
    'full stack',
    'java',
    'angular',
    'react',
    'python',
    'qa',
    'tester',
  ]);
  return technicalRole && !hasJuniorOrMentorshipSignal(titleText, descriptionText);
}

function hasJuniorOrMentorshipSignal(titleText, descriptionText) {
  const earlyTitleSignal = hasAny(titleText, [
    'junior',
    'estagio',
    'estagiario',
    'intern',
    'internship',
    'trainee',
    'graduate',
    'entry level',
    'recem licenciado',
    'career starter',
  ]);
  if (earlyTitleSignal) return true;

  const earlyDescriptionSignal = hasAny(descriptionText, [
    'estagio',
    'estagiario',
    'internship',
    'trainee',
    'graduate program',
    'entry level',
    'recem licenciado',
    'career starter',
    'perfis junior',
    'perfil junior',
    'vaga junior',
    'junior role',
    'junior opportunity',
  ]);
  if (earlyDescriptionSignal) return true;

  return hasAny(descriptionText, [
    'training budget',
    'plano de formacao',
    'formacao ajustado',
    'formacao personalizada',
    'mentorship',
    'mentoria',
    'acompanhamento',
    'feedback constante',
    'sob orientacao',
    'under guidance',
    'learn from',
    'aprender com',
  ]);
}

function hasAny(text, needles) {
  return needles.some((needle) => text.includes(normalizeText(needle)));
}

function mergeQualityConfig(base, override = {}) {
  return {
    ...base,
    ...override,
    minimums: {
      ...base.minimums,
      ...(override.minimums || {}),
    },
    required: override.required || base.required,
    reject_if: override.reject_if || base.reject_if,
    warn_if: override.warn_if || base.warn_if,
  };
}
