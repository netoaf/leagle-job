import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateJobFit } from '../job-scoring-service.mjs';
import { applicationFacingRole, inferLanguage, isConfirmedSkillMatch } from '../scan-and-rank.mjs';

const baseConfigs = {
  profile: {
    education: {
      completed_higher_education: false,
    },
    target_roles: {
      primary: ['Junior backend developer', 'Estagio desenvolvimento web'],
      secondary: ['Automation intern'],
    },
    languages: {
      confirmed: ['Portuguese', 'English'],
    },
    skills: {
      confirmed: [
        { name: 'JavaScript' },
        { name: 'Node.js' },
        { name: 'C#' },
        { name: 'SQL Server' },
      ],
    },
  },
  scoring: {
    weights: {
      target_role_fit: 20,
      technical_stack: 20,
      mentorship_learning: 20,
      progression: 15,
      location_remote: 10,
      compensation: 10,
      clarity_credibility: 5,
    },
    recommendation_thresholds: {
      apply_min: 75,
      maybe_min: 60,
      discard_below: 60,
    },
    hard_blockers: [
      'non_technical_role',
      'senior_required',
      'requires_completed_higher_education',
      'fake_junior_role',
      'presencial_too_far',
    ],
    red_flag_penalties: {
      no_required_stack_match: -30,
    },
  },
};

test('does not treat JavaScript as Java', () => {
  const result = evaluateJobFit({
    title: 'Junior Java Developer',
    company: 'Example',
    description: 'Junior role with mentoring, training and progression. Development in Java.',
    location: 'Lisboa',
    work_mode: 'Hybrid',
    compensation: 'paid',
    stack_required: ['Java'],
  }, baseConfigs);

  assert.equal(result.strengths.some((value) => value.includes('stack_match:Java')), false);
  assert.equal(result.red_flags.includes('no_required_stack_match'), true);
});

test('blocks roles that require completed higher education', () => {
  const result = evaluateJobFit({
    title: 'Junior Backend Developer',
    company: 'Example',
    description: 'Formacao superior em TI. Junior role with mentoring and progression.',
    location: 'Lisboa',
    work_mode: 'Hybrid',
    compensation: 'paid',
    stack_required: ['JavaScript'],
  }, baseConfigs);

  assert.equal(result.hard_blockers_triggered.includes('requires_completed_higher_education'), true);
  assert.equal(result.recommendation, 'discard');
});

test('blocks explicit completed higher education wording from Portuguese listings', () => {
  const result = evaluateJobFit({
    title: 'Estagio em IT - Suporte',
    company: 'Example',
    description: 'Estagio profissional. Ensino superior completo (obrigatorio). Formacao e acompanhamento incluidos.',
    location: 'Lisboa',
    work_mode: 'Onsite',
    compensation: 'a confirmar',
    stack_required: ['Windows'],
  }, baseConfigs);

  assert.equal(result.hard_blockers_triggered.includes('requires_completed_higher_education'), true);
  assert.equal(result.recommendation, 'discard');
  assert.equal(result.score < 60, true);
});

test('blocks licenciatura requirements when the candidate has no completed degree', () => {
  const result = evaluateJobFit({
    title: 'Junior SAP Basis Consultant',
    company: 'Example',
    description: 'Requisitos: Licenciatura em Engenharia Informatica. Trabalho com consultores experientes.',
    location: 'Lisboa',
    work_mode: 'Hybrid',
    compensation: 'a confirmar',
    stack_required: ['SQL'],
  }, baseConfigs);

  assert.equal(result.hard_blockers_triggered.includes('requires_completed_higher_education'), true);
  assert.equal(result.recommendation, 'discard');
});

test('does not confuse broadcast schedule programming with software development', () => {
  const result = evaluateJobFit({
    title: 'Tecnico Grelhas Programacao - Conteudos (Junior)',
    company: 'Example',
    description: 'Criacao de grelhas diarias de programacao e preparacao de conteudos para transmissao. Formacao inicial.',
    location: 'Lisboa',
    work_mode: 'Onsite',
    compensation: 'remuneracao compativel',
    stack_required: [],
  }, baseConfigs);

  assert.equal(result.hard_blockers_triggered.includes('non_technical_role'), true);
  assert.equal(result.recommendation, 'discard');
  assert.equal(result.score < 60, true);
});

test('does not classify instructional design as software development', () => {
  const result = evaluateJobFit({
    title: 'Tecnico de Formacao E-learning - Instructional Designer - Estagio Profissional',
    company: 'Example',
    description: 'Criacao de conteudos digitais e formacao em plataformas e-learning.',
    location: 'Lisboa',
    work_mode: 'Hybrid',
    compensation: 'a confirmar',
    stack_required: [],
  }, baseConfigs);

  assert.equal(result.hard_blockers_triggered.includes('non_technical_role'), true);
  assert.equal(result.recommendation, 'discard');
});

test('does not award full location score to hybrid roles far from Lisbon', () => {
  const result = evaluateJobFit({
    title: 'Full-Stack Developer Junior',
    company: 'Example',
    description: 'Desenvolvimento full-stack com acompanhamento e possibilidade de continuidade.',
    location: 'Braga, Portugal',
    work_mode: 'Hybrid',
    compensation: '1700 euros',
    stack_required: ['JavaScript', 'Node.js'],
  }, baseConfigs);

  assert.equal(result.score_breakdown.location_remote, 3.5);
  assert.equal(result.hard_blockers_triggered.includes('presencial_too_far'), true);
  assert.equal(result.recommendation, 'discard');
});

test('keeps remote roles eligible even when the company location is outside Lisbon', () => {
  const result = evaluateJobFit({
    title: 'Junior Backend Developer',
    company: 'Example',
    description: 'Remote junior role with mentoring and progression.',
    location: 'Braga, Portugal',
    work_mode: 'Remote',
    compensation: 'paid',
    stack_required: ['JavaScript', 'Node.js'],
  }, baseConfigs);

  assert.equal(result.hard_blockers_triggered.includes('presencial_too_far'), false);
});

test('keeps level-4 vocational internships eligible', () => {
  const result = evaluateJobFit({
    title: 'Estagio Programador',
    company: 'Example',
    description: 'Curso profissional nivel 4. Estagio remunerado com acompanhamento e possibilidade de integracao.',
    location: 'Lisboa',
    work_mode: 'Onsite',
    compensation: 'estagio remunerado',
    stack_required: ['C#', 'SQL'],
  }, baseConfigs);

  assert.equal(result.hard_blockers_triggered.includes('requires_completed_higher_education'), false);
  assert.equal(result.recommendation, 'apply');
});

test('does not mistake company history for a candidate experience requirement', () => {
  const result = evaluateJobFit({
    title: 'Consultor Funcional Junior',
    company: 'Example',
    description: 'Empresa com mais de 40 anos de experiencia em software. Perfil: formacao em Informatica, vontade de aprender e acompanhamento proximo.',
    location: 'Lisboa',
    work_mode: 'Onsite',
    compensation: 'a confirmar',
    stack_required: ['SQL'],
  }, baseConfigs);

  assert.equal(result.red_flags.includes('asks_2_plus_years_for_junior'), false);
  assert.equal(result.hard_blockers_triggered.includes('fake_junior_role'), false);
});

test('still detects an explicit candidate experience requirement', () => {
  const result = evaluateJobFit({
    title: 'Junior Backend Developer',
    company: 'Example',
    description: 'Candidate requirements: minimum 2 years of professional experience. Mentoring and training included.',
    location: 'Lisboa',
    work_mode: 'Hybrid',
    compensation: 'paid',
    stack_required: ['JavaScript'],
  }, baseConfigs);

  assert.equal(result.red_flags.includes('asks_2_plus_years_for_junior'), true);
  assert.equal(result.hard_blockers_triggered.includes('fake_junior_role'), true);
});

test('reduces stack mismatch penalty for a broad mentored internship', () => {
  const configs = structuredClone(baseConfigs);
  configs.scoring.red_flag_penalties.no_required_stack_match = -30;

  const broadInternship = evaluateJobFit({
    title: 'Estagio Curricular IT',
    company: 'Example',
    description: 'Estagio curricular com formacao, acompanhamento e oportunidade de aprender sistemas e redes.',
    location: 'Lisboa',
    work_mode: 'Hybrid',
    compensation: 'a confirmar',
    stack_required: ['Linux'],
  }, configs);
  const technologySpecificRole = evaluateJobFit({
    title: 'Junior Java Developer',
    company: 'Example',
    description: 'Junior Java role with training and mentorship.',
    location: 'Lisboa',
    work_mode: 'Hybrid',
    compensation: 'a confirmar',
    stack_required: ['Java'],
  }, configs);

  assert.equal(broadInternship.score > technologySpecificRole.score, true);
  assert.equal(broadInternship.hard_blockers_triggered.length, 0);
});

test('does not block a listing that explicitly offers separate senior and junior tracks', () => {
  const result = evaluateJobFit({
    title: 'Programador Senior / Junior',
    company: 'Example',
    description: 'Iremos incorporar um programador Senior e um programador Junior. Perfil junior: JavaScript, CSS e SQL. Oportunidade de desenvolvimento profissional.',
    location: 'Sintra',
    work_mode: 'Onsite',
    compensation: 'remuneracao de acordo com competencias',
    stack_required: ['JavaScript', 'SQL'],
  }, baseConfigs);

  assert.equal(result.hard_blockers_triggered.includes('senior_required'), false);
});

test('recognizes learn-from-us wording as concrete internship mentorship', () => {
  const result = evaluateJobFit({
    title: 'Computer Sciences Intern',
    company: 'Example',
    description: 'As an intern, you will learn from us while we guide you through the basics and help you improve.',
    location: 'Lisboa',
    work_mode: 'Remote',
    compensation: 'a confirmar',
    stack_required: [],
  }, baseConfigs);

  assert.equal(result.red_flags.includes('no_mentorship'), false);
});

test('selects English for an English vacancy located in Lisbon', () => {
  const language = inferLanguage({
    title: 'Computer Sciences Intern',
    company: 'Fabrica',
    location: 'Lisbon, Portugal',
    link: 'https://wearefabrica.com/jobs/apply/internship',
    description: 'As an intern, you will learn from our team, build products, improve your skills and gain development experience.',
  });

  assert.equal(language, 'en');
});

test('does not turn company longevity into experience when the page is one long segment', () => {
  const result = evaluateJobFit({
    title: 'Consultor Funcional Junior',
    company: 'Example',
    description: 'Candidato Perfil Empresa com mais de 40 anos de experiencia no desenvolvimento de software. Perfil pretendido Formacao em Informatica e vontade de aprender com acompanhamento.',
    location: 'Lisboa',
    work_mode: 'Onsite',
    compensation: 'a confirmar',
    stack_required: ['SQL'],
  }, baseConfigs);

  assert.equal(result.red_flags.includes('asks_2_plus_years_for_junior'), false);
  assert.equal(result.hard_blockers_triggered.includes('fake_junior_role'), false);
});

test('does not treat projects or one-to-two years as a mandatory experience gate', () => {
  const result = evaluateJobFit({
    title: 'Full-Stack Developer Junior',
    company: 'Example',
    description: 'Primeiras experiencias (estagio, projetos proprios ou 1-2 anos) em desenvolvimento full-stack. Nao e preciso experiencia senior e existe acompanhamento.',
    location: 'Lisboa',
    work_mode: 'Hybrid',
    compensation: '1700 euros',
    stack_required: ['JavaScript', 'Node.js'],
  }, baseConfigs);

  assert.equal(result.red_flags.includes('asks_2_plus_years_for_junior'), false);
  assert.equal(result.hard_blockers_triggered.includes('fake_junior_role'), false);
});

test('recognizes Portuguese remuneration wording as compensation evidence', () => {
  const result = evaluateJobFit({
    title: 'Junior Developer',
    company: 'Example',
    description: 'Vencimento base de 1.700 euros e remuneracao de acordo com competencias. Mentoria e progressao.',
    location: 'Lisboa',
    work_mode: 'Hybrid',
    compensation: 'a confirmar',
    stack_required: ['JavaScript'],
  }, baseConfigs);

  assert.equal(result.red_flags.includes('no_salary_or_stipend'), false);
  assert.equal(result.score_breakdown.compensation, 10);
});

test('targets only the junior track in a dual senior and junior listing draft', () => {
  const role = applicationFacingRole({
    title: 'Programador S\u00e9nior / Junior - PRESENCIAL SINTRA',
    description: 'Enviar CV. Senior - referencia - SMPITS2608 Junior - referencia - SMPITJ2608',
  });

  assert.equal(role, 'Programador Junior - PRESENCIAL SINTRA (ref. SMPITJ2608)');
  assert.equal(role.toLowerCase().includes('senior'), false);
  assert.equal(role.toLowerCase().includes('s\u00e9nior'), false);
});

test('confirmed-skill matching never treats JavaScript as Java', () => {
  assert.equal(isConfirmedSkillMatch('JavaScript', 'Java'), false);
  assert.equal(isConfirmedSkillMatch('JavaScript', 'JavaScript'), true);
  assert.equal(isConfirmedSkillMatch('SQL Server', 'SQL'), true);
});
