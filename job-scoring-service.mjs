#!/usr/bin/env node

import { existsSync, readdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadJobFinderConfigs, loadYamlFile } from './lib/config-loader.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;

const SEVERE_HARD_BLOCKERS = new Set([
  'scam_or_mlm',
  'sales_disguised_as_it',
  'non_technical_role',
  'senior_required',
  'requires_completed_higher_education',
  'private_data_required',
  'fake_junior_role',
  'presencial_too_far',
]);

export function validateScoringConfig(scoring) {
  const errors = [];
  const warnings = [];

  if (!scoring || typeof scoring !== 'object') {
    return { errors: ['config/scoring.yml could not be loaded as an object.'], warnings };
  }

  const min = Number(scoring.scale?.min);
  const max = Number(scoring.scale?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min !== 0 || max !== 100) {
    errors.push('scale.min must be 0 and scale.max must be 100.');
  }

  const weights = scoring.weights || {};
  const weightValues = Object.values(weights).map(Number);
  const weightSum = weightValues.reduce((sum, value) => sum + value, 0);
  if (weightValues.length === 0) {
    errors.push('weights cannot be empty.');
  } else if (weightSum !== 100) {
    errors.push(`weights must sum to 100. Current sum: ${weightSum}.`);
  }

  const expectedWeights = [
    'target_role_fit',
    'technical_stack',
    'mentorship_learning',
    'progression',
    'location_remote',
    'compensation',
    'clarity_credibility',
  ];
  for (const key of expectedWeights) {
    if (!Object.hasOwn(weights, key)) errors.push(`weights.${key} is required.`);
  }

  const thresholds = scoring.recommendation_thresholds || {};
  for (const key of ['apply_min', 'maybe_min', 'discard_below']) {
    const value = Number(thresholds[key]);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      errors.push(`recommendation_thresholds.${key} must be between 0 and 100.`);
    }
  }
  if (Number(thresholds.apply_min) < Number(thresholds.maybe_min)) {
    errors.push('recommendation_thresholds.apply_min must be >= maybe_min.');
  }
  if (Number(thresholds.discard_below) !== Number(thresholds.maybe_min)) {
    warnings.push('discard_below and maybe_min usually match; confirm if this is intentional.');
  }

  if (!Array.isArray(scoring.hard_blockers) || scoring.hard_blockers.length === 0) {
    errors.push('hard_blockers cannot be empty.');
  }

  if (!Array.isArray(scoring.output_required_fields) || scoring.output_required_fields.length === 0) {
    errors.push('output_required_fields cannot be empty.');
  }

  return { errors, warnings };
}

export function validateRulesConfig(rules) {
  const errors = [];
  const warnings = [];

  if (!rules || typeof rules !== 'object') {
    return { errors: ['config/jobfinder-rules.yml could not be loaded as an object.'], warnings };
  }

  if (!Array.isArray(rules.critical_rules) || rules.critical_rules.length === 0) {
    errors.push('critical_rules cannot be empty.');
  }
  if (!Array.isArray(rules.privacy?.allow) || rules.privacy.allow.length === 0) {
    errors.push('privacy.allow cannot be empty.');
  }
  if (!Array.isArray(rules.privacy?.deny) || rules.privacy.deny.length === 0) {
    errors.push('privacy.deny cannot be empty.');
  }

  return { errors, warnings };
}

export function validateJobFinderConfig(configs) {
  const scoringResult = validateScoringConfig(configs.scoring);
  const rulesResult = validateRulesConfig(configs.rules);
  return {
    errors: [...scoringResult.errors, ...rulesResult.errors],
    warnings: [...scoringResult.warnings, ...rulesResult.warnings],
  };
}

export function evaluateJobFit(job, configs = loadJobFinderConfigs(projectRoot)) {
  const { profile, scoring } = configs;
  const weights = scoring.weights;
  const thresholds = scoring.recommendation_thresholds;
  const penalties = scoring.red_flag_penalties || {};

  const text = normalizeText(toText(job));
  const titleText = normalizeText(job.title || '');
  const stack = getJobStack(job, text);
  const skillNames = getProfileSkillNames(profile);

  const scoreBreakdown = {
    target_role_fit: round(scoreTargetRoleFit(job, text, titleText, profile, weights.target_role_fit)),
    technical_stack: round(scoreTechnicalStack(stack, skillNames, text, weights.technical_stack)),
    mentorship_learning: round(scoreMentorship(job, text, weights.mentorship_learning)),
    progression: round(scoreProgression(job, text, weights.progression)),
    location_remote: round(scoreLocation(job, text, weights.location_remote)),
    compensation: round(scoreCompensation(job, text, weights.compensation)),
    clarity_credibility: round(scoreClarity(job, stack, text, weights.clarity_credibility)),
  };

  const strengths = detectStrengths(job, text, stack, skillNames);
  const redFlags = detectRedFlags(job, text, stack, profile);
  const hardBlockersTriggered = detectHardBlockers(job, text, redFlags, scoring.hard_blockers || [], profile);

  const rawScore = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);
  const contextualPenalties = detectContextualPenalties(job, text);
  const penaltyTotal = redFlags.reduce((sum, flag) => sum + penaltyForRedFlag(flag, penalties, job, text), 0) + contextualPenalties.total;
  const finalScore = clamp(round(rawScore + penaltyTotal), 0, 100);
  const severeBlocker = hardBlockersTriggered.some((blocker) => SEVERE_HARD_BLOCKERS.has(blocker));
  const effectiveScore = severeBlocker
    ? Math.min(finalScore, Math.max(0, Number(thresholds.discard_below) - 1))
    : finalScore;

  let recommendation = 'discard';
  if (severeBlocker) {
    recommendation = 'discard';
  } else if (effectiveScore >= Number(thresholds.apply_min)) {
    recommendation = 'apply';
  } else if (effectiveScore >= Number(thresholds.maybe_min)) {
    recommendation = 'maybe';
  }

  return {
    score: effectiveScore,
    recommendation,
    score_breakdown: scoreBreakdown,
    strengths,
    red_flags: [...redFlags, ...contextualPenalties.flags],
    hard_blockers_triggered: hardBlockersTriggered,
    reasoning: buildReasoning(rawScore, penaltyTotal, effectiveScore, hardBlockersTriggered, recommendation),
    next_action: nextActionFor(recommendation, hardBlockersTriggered),
  };
}

function scoreTargetRoleFit(job, text, titleText, profile, weight) {
  if (isClearlyNonTechnical(text)) return 0;

  const targetRoles = [
    ...asArray(profile.target_roles?.primary),
    ...asArray(profile.target_roles?.secondary),
  ].map(normalizeText);
  const directRoleHit = targetRoles.some((role) => role && phraseOverlap(role, text) >= 0.45);
  const earlyCareer = hasAny(text, ['estagio', 'estagiario', 'estagiaria', 'intern', 'internship', 'trainee', 'junior', 'entry level']);
  const devSignal = hasAny(text, ['software', 'developer', 'programador', 'desenvolvedor', 'web', 'backend', 'frontend', 'full stack', 'full-stack', 'automation', 'automacao', 'qa', 'tester', 'ai tools', 'prompt', 'workflow']);
  const supportWithProgression = hasAny(text, ['technical support', 'suporte tecnico', 'helpdesk']) && hasAny(text, ['automation', 'automacao', 'scripts', 'development', 'desenvolvimento', 'progression', 'progressao']);

  if (directRoleHit || (earlyCareer && devSignal)) return weight;
  if (supportWithProgression) return weight * 0.65;
  if (devSignal) return weight * 0.6;
  if (titleText.includes('it') && earlyCareer) return weight * 0.45;
  return weight * 0.2;
}

function scoreTechnicalStack(stack, skillNames, text, weight) {
  if (stack.length === 0) return weight * 0.35;
  const matches = stack.filter((tech) => skillNames.some((skill) => technologiesMatch(skill, tech)));
  const ratio = matches.length / stack.length;
  const learningBonus = hasAny(text, ['junior', 'estagio', 'internship', 'trainee', 'learn', 'aprender']) ? 0.15 : 0;
  return weight * clamp(ratio + learningBonus, 0, 1);
}

function scoreMentorship(job, text, weight) {
  if (job.mentorship === true) return weight;
  if (job.mentorship === false || hasAny(text, ['no mentorship', 'sem mentoria', 'autonomous from day one'])) return weight * 0.15;
  if (hasAny(text, ['mentoria', 'mentor', 'mentorship', 'acompanhamento', 'formacao', 'training', 'learn', 'aprender', 'willingness to learn', 'curiosity', 'senior developers', 'onboarding', 'documentation', 'informal training'])) return weight;
  if (hasAny(text, ['estagio', 'internship', 'trainee', 'junior'])) return weight * 0.65;
  return weight * 0.35;
}

function scoreProgression(job, text, weight) {
  if (job.progression === true || job.contract_possible === true) return weight;
  if (job.progression === false) return weight * 0.2;
  if (hasAny(text, ['progression', 'progressao', 'contrato', 'integration', 'integracao', 'continuidade', 'continuity', 'career path', 'crescimento', 'evolucao'])) return weight;
  if (hasAny(text, ['estagio', 'internship', 'trainee'])) return weight * 0.55;
  return weight * 0.35;
}

function scoreLocation(job, text, weight) {
  const workMode = normalizeText(job.work_mode || '');
  const location = normalizeText(job.location || '');
  if (hasAny(workMode, ['remote', 'remoto']) || hasAny(text, ['remote', 'remoto'])) return weight;
  if (hasAny(workMode, ['hybrid', 'hibrido']) || hasAny(text, ['hybrid', 'hibrido'])) {
    return hasAny(location, ['lisboa', 'lisbon']) ? weight : weight * 0.35;
  }
  if (hasAny(location, ['lisboa', 'lisbon'])) return weight * 0.75;
  if (hasAny(workMode, ['onsite', 'presencial']) && !hasAny(location, ['lisboa', 'lisbon'])) return weight * 0.25;
  return weight * 0.5;
}

function scoreCompensation(job, text, weight) {
  const compensation = normalizeText(job.compensation || '');
  if (hasAny(compensation, ['paid', 'remunerado', 'remuneracao', 'vencimento', 'bolsa', 'stipend', 'salary', 'salario']) || hasAny(text, ['paid internship', 'estagio remunerado', 'remuneracao', 'vencimento', 'bolsa', 'stipend', 'salary', 'salario'])) return weight;
  if (hasAny(compensation, ['unpaid', 'nao remunerado', 'sem remuneracao']) || hasAny(text, ['unpaid', 'nao remunerado', 'sem remuneracao'])) return 0;
  return weight * 0.45;
}

function scoreClarity(job, stack, text, weight) {
  const hasCompany = Boolean(job.company);
  const hasTitle = Boolean(job.title);
  const hasTasks = hasAny(text, ['responsibilities', 'responsabilidades', 'tarefas', 'tasks', 'you will', 'vais', 'what you will do', 'youll do', 'you ll do']);
  const hasStack = stack.length > 0;
  const enoughDescription = normalizeText(job.description || '').length >= 120;
  const points = [hasCompany, hasTitle, hasTasks, hasStack, enoughDescription].filter(Boolean).length;
  return weight * (points / 5);
}

function detectStrengths(job, text, stack, skillNames) {
  const strengths = [];
  if (hasAny(text, ['estagio', 'internship', 'trainee', 'junior'])) strengths.push('early_career_level');
  if (hasAny(text, ['remote', 'remoto', 'hybrid', 'hibrido', 'lisboa', 'lisbon'])) strengths.push('location_or_work_mode_fit');
  if (hasAny(text, ['mentor', 'mentoria', 'training', 'formacao', 'learn', 'aprender', 'willingness to learn', 'curiosity', 'onboarding', 'documentation', 'informal training'])) strengths.push('mentorship_or_learning_signal');
  if (hasAny(text, ['progression', 'progressao', 'contrato', 'integracao', 'continuidade', 'continuity'])) strengths.push('progression_signal');
  const matchedStack = stack.filter((tech) => skillNames.some((skill) => technologiesMatch(skill, tech)));
  if (matchedStack.length > 0) strengths.push(`stack_match:${matchedStack.join(', ')}`);
  return strengths;
}

function detectRedFlags(job, text, stack, profile) {
  const flags = new Set();
  const years = extractYears(text);
  const earlyCareer = hasAny(text, ['junior', 'estagio', 'estagiario', 'estagiaria', 'intern', 'internship', 'trainee']);

  if (earlyCareer && years >= 2) flags.add('asks_2_plus_years_for_junior');
  if (!hasCompensation(job, text)) flags.add('no_salary_or_stipend');
  if (!hasMentorship(job, text)) flags.add('no_mentorship');
  if (stack.length === 0) flags.add('unclear_stack');
  if (stack.length > 0 && !stack.some((tech) => getProfileSkillNames(profile).some((skill) => technologiesMatch(skill, tech)))) {
    flags.add('no_required_stack_match');
  }
  if (isSalesDisguisedAsIT(text)) flags.add('sales_disguised_as_it');
  if (isFarOnsite(job, text)) flags.add('far_onsite_location');
  if (isVague(job, text)) flags.add('vague_description');
  if (requiresUnownedCertification(text)) flags.add('requires_unowned_certification');
  if (requiresUnconfirmedLanguage(job, profile)) flags.add('unconfirmed_required_language');
  if (job.company_presence === false || normalizeText(job.company_presence || '').includes('suspicious') || hasAny(text, ['no company name', 'empresa confidencial suspeita'])) flags.add('suspicious_company_presence');

  return [...flags];
}

function detectContextualPenalties(job, text) {
  const flags = [];
  let total = 0;
  const earlyCareer = hasEarlyCareerSignal(text);
  const title = normalizeText(job.title || '');
  const location = normalizeText(job.location || '');

  if (!earlyCareer && hasAny(title, ['software engineer', 'backend engineer', 'frontend engineer', 'full stack engineer', 'full-stack engineer', 'machine learning', 'research internship'])) {
    flags.push('no_explicit_junior_or_internship_signal');
    total -= 25;
  }

  if (!earlyCareer && hasAny(text, ['startup', 'scale', 'ownership', 'production', 'customer-facing', 'high-impact', 'autonomous'])) {
    flags.push('likely_requires_independent_delivery');
    total -= 10;
  }

  if (hasAny(location, ['new york', 'san francisco', 'singapore', 'toronto', 'united states', 'usa']) && !hasAny(text, ['remote europe', 'remote emea', 'portugal', 'lisbon', 'lisboa'])) {
    flags.push('geo_or_timezone_stretch');
    total -= 15;
  }

  return { flags, total };
}

function penaltyForRedFlag(flag, penalties, job, text) {
  const configured = Number(penalties[flag] || 0);
  if (flag !== 'no_required_stack_match' || configured >= 0) return configured;

  const title = normalizeText(job.title || '');
  const technologySpecificTitle = hasAny(title, [
    'java', 'c#', '.net', 'php', 'python', 'react', 'angular', 'salesforce',
    'sap', 'oracle', 'linux kernel', 'devops', 'data engineer',
  ]);
  const learningRole = hasEarlyCareerSignal(text) && hasMentorship(job, text);

  return learningRole && !technologySpecificTitle ? Math.max(configured, -8) : configured;
}

function detectHardBlockers(job, text, redFlags, configuredBlockers, profile) {
  const blockers = new Set();
  const allowed = new Set(configuredBlockers);
  const add = (key) => {
    if (allowed.has(key) || SEVERE_HARD_BLOCKERS.has(key)) blockers.add(key);
  };

  if (isClearlyNonTechnical(text)) add('non_technical_role');
  if (isNonSoftwareProgrammingRole(job)) add('non_technical_role');
  if (isScamOrMlm(text)) add('scam_or_mlm');
  if (redFlags.includes('sales_disguised_as_it')) add('sales_disguised_as_it');
  if (isSeniorRequired(job, text)) add('senior_required');
  if (requiresCompletedHigherEducation(text) && !profileHasCompletedHigherEducation(profile)) {
    add('requires_completed_higher_education');
  }
  if (job.requires_private_data === true || hasAny(text, ['nif obrigatorio antes da entrevista', 'citizen card required before interview', 'api key', 'private token'])) add('private_data_required');
  if (isUnpaidWithoutMentorship(job, text)) add('unpaid_without_strong_mentorship');
  if (isFarOnsite(job, text)) add('presencial_too_far');
  if (isFakeJunior(job, text)) add('fake_junior_role');
  if (isVague(job, text) && (job.company_presence === false || isScamOrMlm(text))) add('vague_or_suspicious_description');

  return [...blockers];
}

function getJobStack(job, text) {
  const explicit = asArray(job.stack_required).filter(Boolean);
  if (explicit.length > 0) return explicit.map(String);

  const knownTech = [
    'C#', '.NET', 'JavaScript', 'TypeScript', 'HTML', 'CSS', 'React', 'Next.js',
    'Node.js', 'Express', 'SQL', 'PostgreSQL', 'SQL Server', 'Python', 'Java',
    'Windows Forms', 'Arduino', 'Swagger', 'Postman', 'REST API', 'API',
    'AI tools', 'ChatGPT', 'Gemini', 'NotebookLM', 'Rovo', 'prompt', 'prompt writing',
    'automation', 'data analysis', 'workflow', 'workflows',
  ];
  return knownTech.filter((tech) => normalizeText(text).includes(normalizeText(tech)));
}

function getProfileSkillNames(profile) {
  return asArray(profile.skills?.confirmed)
    .map((skill) => typeof skill === 'string' ? skill : skill?.name)
    .filter(Boolean);
}

function getProfileLanguageNames(profile) {
  return asArray(profile.languages?.confirmed)
    .map((language) => typeof language === 'string' ? language : language?.name)
    .filter(Boolean);
}

function isClearlyNonTechnical(text) {
  const technical = hasAny(text, ['developer', 'programador', 'software', 'web', 'backend', 'frontend', 'full stack', 'automation', 'automacao', 'qa', 'tester', 'sql', 'python', 'javascript', 'react', 'node', 'ai tools', 'prompt', 'workflow']);
  const nonTechnical = hasAny(text, ['sales', 'vendas', 'telemarketing', 'call center', 'marketing assistant', 'door-to-door', 'porta a porta']);
  return nonTechnical && !technical;
}

function isSalesDisguisedAsIT(text) {
  return hasAny(text, ['sales', 'vendas', 'comercial', 'telemarketing', 'call center', 'account executive', 'door-to-door', 'porta a porta']) &&
    !hasAny(text, ['software development', 'desenvolvimento de software', 'programacao', 'coding', 'developer']);
}

function isScamOrMlm(text) {
  return hasAny(text, ['mlm', 'multi-level', 'forex', 'crypto opportunity', 'ganhos ilimitados', 'unlimited earnings', 'commission only', 'comissoes apenas', 'get rich']);
}

function isSeniorRequired(job, text) {
  const years = extractYears(text);
  const title = normalizeText(job.title || '');
  const offersJuniorTrack = hasAny(title, ['junior', 'intern', 'estagio', 'trainee']);
  const seniorTitle = hasAny(title, ['senior', 'lead', 'principal', 'head of']) && !offersJuniorTrack;
  const explicitRequirement = hasAny(text, ['senior profile required', 'perfil senior', 'senior-level candidate', 'mid-level or senior', 'mid/senior']);
  return seniorTitle || explicitRequirement || years >= 3;
}

function requiresCompletedHigherEducation(text) {
  const source = normalizeForPhraseMatching(text);
  const explicitlyOptional = [
    'degree preferred',
    'degree is preferred',
    'licenciatura preferencial',
    'formacao superior preferencial',
    'degree or equivalent experience',
    'degree or equivalent practical experience',
    'licenciatura ou experiencia equivalente',
    'a frequentar licenciatura',
  ].some((phrase) => source.includes(phrase));
  if (explicitlyOptional) return false;

  return [
    'formacao superior em',
    'ensino superior completo',
    'licenciatura concluida',
    'licenciatura completa',
    'licenciatura em',
    'licenciado em',
    'bachelor degree',
    'bachelors degree',
    'university degree required',
    'higher education degree',
    'completed degree',
    'degree in computer engineer',
    'degree in computer science',
    'degree in software engineering',
  ].some((phrase) => source.includes(phrase));
}

function isNonSoftwareProgrammingRole(job) {
  const title = normalizeText(job.title || '');
  return hasAny(title, [
    'grelhas programacao',
    'programacao conteudos',
    'programacao de conteudos',
    'programador cnc',
    'operador cnc',
    'instructional designer',
    'formacao e-learning',
    'tecnico de formacao',
  ]);
}

function profileHasCompletedHigherEducation(profile) {
  return profile?.education?.completed_higher_education === true;
}

function hasEarlyCareerSignal(text) {
  return hasAny(text, ['junior', 'estagio', 'estagiario', 'estagiaria', 'intern', 'internship', 'trainee', 'entry level', 'graduate', 'career starter', 'iefp']);
}

function isFakeJunior(job, text) {
  const years = extractYears(text);
  return hasAny(text, ['junior', 'estagio', 'internship', 'trainee']) && years >= 2;
}

function isUnpaidWithoutMentorship(job, text) {
  return !hasCompensation(job, text) && !hasMentorship(job, text) &&
    (hasAny(text, ['unpaid', 'nao remunerado', 'sem remuneracao']) || job.compensation === false || job.compensation === '');
}

function isFarOnsite(job, text) {
  const workMode = normalizeText(job.work_mode || '');
  const location = normalizeText(job.location || '');
  const markedFar = job.far_from_lisbon === true || job.heavy_commute === true;
  const onsite = hasAny(workMode, ['onsite', 'presencial']) || hasAny(text, ['onsite', 'presencial']);
  const hybrid = hasAny(workMode, ['hybrid', 'hibrido']) || hasAny(text, ['hybrid', 'hibrido']);
  const explicitlyRemote = hasAny(workMode, ['remote', 'remoto']) || hasAny(location, ['remote', 'remoto']);
  const outsideLisbon = Boolean(location) && !hasAny(location, [
    'lisboa', 'lisbon', 'oeiras', 'porto salvo', 'cascais', 'sintra', 'amadora', 'odivelas',
    'loures', 'almada', 'seixal', 'barreiro',
  ]);
  return markedFar || (!explicitlyRemote && outsideLisbon && (onsite || hybrid));
}

function isVague(job, text) {
  const description = normalizeText(job.description || '');
  const vagueWords = hasAny(text, ['dynamic environment', 'ambiente dinamico', 'many tasks', 'varias tarefas', 'young team']);
  return description.length < 80 || (vagueWords && getJobStack(job, text).length === 0);
}

function requiresUnownedCertification(text) {
  return hasAny(text, ['certification required', 'certificacao obrigatoria', 'ccna required', 'aws certified required', 'microsoft certification required']);
}

function requiresUnconfirmedLanguage(job, profile) {
  const confirmed = new Set(getProfileLanguageNames(profile).map(canonicalLanguage).filter(Boolean));
  if (confirmed.size === 0) return false;

  const source = normalizeForPhraseMatching(`${job.title || ''} ${job.description || ''} ${job.requirements || ''}`);
  const languages = [
    { key: 'portuguese', aliases: ['portuguese', 'portugues'] },
    { key: 'english', aliases: ['english', 'ingles'] },
    { key: 'german', aliases: ['german', 'deutsch', 'alemao'] },
    { key: 'french', aliases: ['french', 'frances'] },
    { key: 'spanish', aliases: ['spanish', 'espanhol', 'castilian'] },
    { key: 'italian', aliases: ['italian', 'italiano'] },
    { key: 'dutch', aliases: ['dutch', 'holandes'] },
  ];

  return languages.some((language) =>
    !confirmed.has(language.key) && language.aliases.some((alias) => hasRequiredLanguagePhrase(source, alias)));
}

function hasRequiredLanguagePhrase(source, alias) {
  return [
    `${alias} speaking`,
    `${alias} speaker`,
    `${alias} native`,
    `${alias} fluency`,
    `${alias} required`,
    `fluent ${alias}`,
    `fluent in ${alias}`,
    `native ${alias}`,
    `required ${alias}`,
    `c1 ${alias}`,
    `${alias} c1`,
    `b2 ${alias}`,
    `${alias} b2`,
  ].some((phrase) => source.includes(phrase));
}

function canonicalLanguage(value) {
  const text = normalizeForPhraseMatching(value);
  if (hasAny(text, ['portuguese', 'portugues'])) return 'portuguese';
  if (hasAny(text, ['english', 'ingles'])) return 'english';
  if (hasAny(text, ['german', 'deutsch', 'alemao'])) return 'german';
  if (hasAny(text, ['french', 'frances'])) return 'french';
  if (hasAny(text, ['spanish', 'espanhol', 'castilian'])) return 'spanish';
  if (hasAny(text, ['italian', 'italiano'])) return 'italian';
  if (hasAny(text, ['dutch', 'holandes'])) return 'dutch';
  return text;
}

function hasCompensation(job, text) {
  if (job.compensation === true) return true;
  const compensation = normalizeText(job.compensation || '');
  return hasAny(compensation, ['paid', 'remunerado', 'remuneracao', 'vencimento', 'bolsa', 'stipend', 'salary', 'salario']) ||
    hasAny(text, ['paid internship', 'estagio remunerado', 'remuneracao', 'vencimento', 'bolsa', 'stipend', 'salary', 'salario']);
}

function hasMentorship(job, text) {
  if (job.mentorship === true) return true;
  if (job.mentorship === false) return false;
  return hasAny(text, ['mentoria', 'mentor', 'mentorship', 'acompanhamento', 'training', 'formacao', 'learn with', 'learn from', 'aprender com', 'willingness to learn', 'curiosity', 'onboarding', 'documentation', 'informal training']);
}

function extractYears(text) {
  const segments = normalizeText(text).split(/[.!?;\n|]+/).filter(Boolean);
  const matches = [];
  const explicitPatterns = [
    /\b(?:minimum|minimo|minima|at least|pelo menos)\s+(?:de\s+)?(\d+)\+?\s*(?:years|anos|year|ano)\b/g,
    /\b(?:experiencia minima|minimum experience|professional experience required|experiencia profissional obrigatoria)[^.!?;\n]{0,50}?(\d+)\+?\s*(?:years|anos|year|ano)\b/g,
    /\b(\d+)\+?\s*(?:years|anos|year|ano)\s+(?:of\s+)?(?:professional|relevant|hands-on|work|profissional|comprovada)\s+(?:experience|experiencia)\b/g,
  ];
  const candidateScopedPattern = /\b(\d+)\+?\s*(?:years|anos|year|ano)\s+(?:of\s+)?(?:experience|experiencia)\b/g;

  for (const segment of segments) {
    const candidateScoped = hasAny(segment, [
      'candidate', 'candidato', 'candidata', 'profile', 'perfil', 'requirements',
      'requisitos', 'we are looking for', 'procuramos', 'you have', 'tens experiencia',
      'must have', 'required', 'obrigatorio', 'experiencia profissional',
    ]);
    const companyScoped = hasAny(segment, [
      'company with', 'empresa com', 'years in the market', 'anos no mercado',
      'years of company experience', 'anos de experiencia da empresa', 'founded', 'fundada',
    ]);
    if (companyScoped && !candidateScoped) continue;

    const patterns = candidateScoped
      ? [...explicitPatterns, candidateScopedPattern]
      : explicitPatterns;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of segment.matchAll(pattern)) {
        const before = segment.slice(Math.max(0, Number(match.index) - 60), Number(match.index));
        const companyHistory = /(?:empresa|company|mercado|market)\s+(?:com|with|ha|for)?[^\d]{0,30}(?:mais de|more than)?\s*$/i.test(before);
        if (!companyHistory) matches.push(Number(match[1]));
      }
    }
  }

  return matches.length > 0 ? Math.max(...matches) : 0;
}

function buildReasoning(rawScore, penaltyTotal, finalScore, hardBlockers, recommendation) {
  const penaltyText = penaltyTotal ? ` penalties ${penaltyTotal}` : ' no penalties';
  const blockerText = hardBlockers.length > 0 ? ` Hard blockers: ${hardBlockers.join(', ')}.` : '';
  return `Raw weighted score ${round(rawScore)}/100,${penaltyText}; final score ${finalScore}/100.${blockerText} Recommendation: ${recommendation}.`;
}

function nextActionFor(recommendation, hardBlockers) {
  if (recommendation === 'apply') return 'Prepare tailored CV/message and ask for approval before sending.';
  if (recommendation === 'maybe') return 'Clarify gaps/red flags before applying; do not send automatically.';
  if (hardBlockers.length > 0) return 'Discard unless the blocker is proven false by reliable information.';
  return 'Discard or keep only for later review.';
}

function phraseOverlap(needle, haystack) {
  const words = needle.split(/\s+/).filter((word) => word.length > 2);
  if (words.length === 0) return 0;
  return words.filter((word) => haystack.includes(word)).length / words.length;
}

function hasAny(text, needles) {
  const source = normalizeText(text);
  return needles.some((needle) => source.includes(normalizeText(needle)));
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeTech(value) {
  return normalizeText(value).replace(/[^a-z0-9+#.]/g, '');
}

function technologiesMatch(left, right) {
  return canonicalTech(left) === canonicalTech(right);
}

function canonicalTech(value) {
  const text = normalizeTech(value);
  if (!text) return '';
  if (['javascript', 'js'].includes(text)) return 'javascript';
  if (text === 'java') return 'java';
  if (['node', 'nodejs', 'node.js'].includes(text)) return 'nodejs';
  if (['c#', 'csharp'].includes(text)) return 'csharp';
  if (text === '.net' || text === 'dotnet' || text.startsWith('asp.net')) return 'dotnet';
  if (['restapi', 'restfulapi', 'api'].includes(text)) return 'api';
  if (['sql', 'sqlserver', 'mssql'].includes(text)) return 'sql';
  if (text.startsWith('entityframework')) return 'entityframework';
  return text;
}

function normalizeForPhraseMatching(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function toText(value) {
  if (Array.isArray(value)) return value.map(toText).join(' ');
  if (value && typeof value === 'object') return Object.values(value).map(toText).join(' ');
  return String(value ?? '');
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 10) / 10;
}

async function main() {
  const args = process.argv.slice(2);
  const configs = loadJobFinderConfigs(projectRoot);

  if (args.includes('--validate')) {
    const result = validateJobFinderConfig(configs);
    printValidationResult(result);
    process.exit(result.errors.length > 0 ? 1 : 0);
  }

  if (args.includes('--examples')) {
    const result = runExampleSuite(configs);
    process.exit(result ? 0 : 1);
  }

  const fileArgs = args.filter((arg) => !arg.startsWith('--'));
  if (fileArgs.length === 0) {
    console.log('Usage: node job-scoring-service.mjs --validate | --examples | examples/jobs/good-internship.yml');
    process.exit(0);
  }

  for (const file of fileArgs) {
    const job = loadYamlFile(resolve(projectRoot, file));
    const evaluation = evaluateJobFit(job, configs);
    console.log(JSON.stringify({ file, evaluation }, null, 2));
  }
}

function printValidationResult(result) {
  console.log('\n=== jobfinder config validation ===\n');
  if (result.errors.length === 0 && result.warnings.length === 0) {
    console.log('All scoring/rules checks passed.\n');
    return;
  }
  for (const error of result.errors) console.log(`ERROR: ${error}`);
  for (const warning of result.warnings) console.log(`WARN: ${warning}`);
  console.log('');
}

function runExampleSuite(configs) {
  const dir = join(projectRoot, 'examples', 'jobs');
  if (!existsSync(dir)) {
    console.error('examples/jobs not found.');
    return false;
  }

  let ok = true;
  const files = readdirSync(dir).filter((file) => file.endsWith('.yml')).sort();
  console.log('\n=== job scoring examples ===\n');
  for (const file of files) {
    const job = loadYamlFile(join(dir, file));
    const expected = job.expected_recommendation;
    const evaluation = evaluateJobFit(job, configs);
    const pass = expected ? evaluation.recommendation === expected : true;
    ok = ok && pass;
    console.log(`${pass ? 'PASS' : 'FAIL'} ${file}: expected ${expected || 'n/a'}, got ${evaluation.recommendation} (${evaluation.score}/100)`);
    if (!pass) {
      console.log(`  hard blockers: ${evaluation.hard_blockers_triggered.join(', ') || 'none'}`);
      console.log(`  red flags: ${evaluation.red_flags.join(', ') || 'none'}`);
    }
  }
  console.log('');
  return ok;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
