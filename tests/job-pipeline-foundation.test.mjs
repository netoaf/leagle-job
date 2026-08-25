import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { enrichJob } from '../lib/job-enrichment.mjs';
import {
  canonicalUrl,
  externalJobKey,
  jobIdentityFields,
  normalizeCompanyName,
  normalizeTitleKey,
} from '../lib/job-identity.mjs';
import {
  extractAnchors,
  extractStack,
  extractYearsExperience,
  inferCompensation,
  inferWorkMode,
  isExpiredText,
  normalizeJob,
} from '../lib/job-normalizer.mjs';
import {
  DEFAULT_QUALITY_GATE,
  evaluateJobQuality,
} from '../lib/job-quality-gate.mjs';
import {
  classifySourceHealth,
  detectSourceAdapter,
} from '../lib/source-adapters.mjs';

const LONG_JUNIOR_DESCRIPTION = [
  'This junior role builds reliable TypeScript services with a supportive team.',
  'You will receive mentorship, pair with experienced engineers and review code.',
  'The work includes tests, documentation, small production changes and regular feedback.',
].join(' ');

const SUCCESSFACTORS_SERVER_RENDERED_HTML = readFileSync(
  new URL('./fixtures/successfactors-server-rendered.html', import.meta.url),
  'utf8',
);

test('rejects access challenges instead of scoring them as vacancies', () => {
  const result = evaluateJobQuality({
    title: 'Additional Verification Required',
    company: 'Security Check',
    link: 'https://pt.indeed.com/viewjob?jk=example',
    description: 'Verify you are human before continuing to the requested page. '.repeat(5),
    location: 'Lisboa',
    work_mode: 'a confirmar',
    source: 'max_extractor',
    http_status: 403,
  }, DEFAULT_QUALITY_GATE);

  assert.equal(result.passed, false);
  assert.ok(result.rejection_reasons.includes('source_access_blocked'));
});

test('normalizes a synthetic job without inventing unknown facts', () => {
  const job = normalizeJob({
    title: 'Jobs: Junior Developer | Example Careers',
    company: 'Example Labs',
    location: 'Lisboa',
    description: '<p>Build <strong>Node.js</strong> services.</p><script>private()</script>',
    link: 'https://jobs.example.test/roles/42',
    source: 'synthetic fixture',
  });

  assert.equal(job.title, 'Junior Developer');
  assert.equal(job.description, 'Build Node.js services.');
  assert.deepEqual(job.stack_required, ['Node.js']);
  assert.equal(job.work_mode, 'a confirmar');
  assert.equal(job.compensation, 'a confirmar');
  assert.equal(job.mentorship, 'a confirmar');
  assert.equal(job.is_active, true);
});

test('repairs UTF-8 Portuguese text decoded as Windows-1252', () => {
  const job = normalizeJob({
    title: 'Administrador/a de Sistemas JÃºnior',
    company: 'SoluÃ§Ãµes &amp; Sistemas InformÃ¡ticos',
    location: 'Lisboa',
    description: 'Curso Profissional IV e conhecimentos de comunicaÃ§Ãµes, redes e informÃ¡tica.',
    link: 'https://jobs.example.test/roles/utf8',
    source: 'synthetic fixture',
  });

  assert.equal(job.title, 'Administrador/a de Sistemas Júnior');
  assert.equal(job.company, 'Soluções & Sistemas Informáticos');
  assert.match(job.description, /comunicações, redes e informática/);
  assert.equal(evaluateJobQuality(job, DEFAULT_QUALITY_GATE).passed, true);
});

test('extracts technologies with token boundaries', () => {
  const stack = extractStack(
    'Maintain reliable TypeScript and C# services on .NET with a REST API.',
  );

  assert.deepEqual(stack, ['C#', '.NET', 'TypeScript', 'REST API']);
  assert.equal(stack.includes('AI'), false);
});

test('infers work mode conservatively', () => {
  assert.equal(inferWorkMode('Fully remote within Portugal'), 'Remote');
  assert.equal(inferWorkMode('Hybrid schedule in Lisboa'), 'Hybrid');
  assert.equal(inferWorkMode('On-site role'), 'Onsite');
  assert.equal(inferWorkMode('Flexible working arrangement'), 'a confirmar');
});

test('extracts bounded evidence without converting it into a promise', () => {
  assert.equal(
    inferCompensation('The salary band is discussed during the interview.'),
    'a confirmar: sinal de remuneracao/bolsa mencionado',
  );
  assert.equal(inferCompensation('Benefits depend on location.'), 'a confirmar');
  assert.equal(extractYearsExperience('Two tracks ask for 1 year or 3+ years.'), 3);
  assert.equal(isExpiredText('This position has been filled.'), true);
  assert.equal(isExpiredText('Applications are open.'), false);
});

test('extracts safe absolute anchors from synthetic HTML', () => {
  const anchors = extractAnchors(`
    <a href="/roles/42"><strong>Junior</strong> Developer</a>
    <a href="https://jobs.example.test/roles/43">Graduate QA</a>
    <a href="/empty"></a>
  `, 'https://jobs.example.test/careers');

  assert.deepEqual(anchors, [
    {
      href: 'https://jobs.example.test/roles/42',
      text: 'Junior Developer',
    },
    {
      href: 'https://jobs.example.test/roles/43',
      text: 'Graduate QA',
    },
  ]);
});

test('canonicalizes URLs while preserving job-identifying parameters', () => {
  assert.equal(
    canonicalUrl('https://www.jobs.example.test/roles/42/?utm_source=test&job=42#apply'),
    'https://jobs.example.test/roles/42?job=42',
  );
  assert.equal(
    canonicalUrl('https://jobs.example.test/roles/42?ref=feed'),
    'https://jobs.example.test/roles/42',
  );
});

test('builds stable source-specific and similarity identities', () => {
  const job = {
    company: 'Example Labs Portugal, Lda.',
    title: 'Junior Software Engineer (m/f/d) - Lisboa',
    location: 'Lisbon, Portugal',
    link: 'https://boards.greenhouse.io/example/jobs/123456?gh_src=feed',
    description: LONG_JUNIOR_DESCRIPTION,
  };
  const identity = jobIdentityFields(job);

  assert.equal(externalJobKey(job), 'greenhouse:123456');
  assert.equal(normalizeCompanyName(job.company), 'example labs lda');
  assert.equal(normalizeTitleKey(job.title), 'junior software engineer');
  assert.equal(identity.canonical_url, 'https://boards.greenhouse.io/example/jobs/123456');
  assert.equal(identity.fingerprint, 'greenhouse:123456');
  assert.match(identity.description_hash, /^[a-f0-9]{16}$/);
});

test('enriches identity and explicit metadata without replacing source evidence', () => {
  const job = enrichJob({
    title: 'Junior Platform Engineer',
    company: 'Example Labs',
    location: 'Lisboa, Portugal',
    work_mode: 'Hybrid',
    description: LONG_JUNIOR_DESCRIPTION,
    link: 'https://boards.greenhouse.io/example/jobs/123456?utm_source=test',
    source: 'synthetic fixture',
    compensation: 'a confirmar',
    stack_required: ['TypeScript'],
    datePosted: '2026-07-20',
    validThrough: '2026-08-20',
    employmentType: 'FULL_TIME',
  });

  assert.equal(job.canonical_url, 'https://boards.greenhouse.io/example/jobs/123456');
  assert.equal(job.external_id, 'greenhouse:123456');
  assert.equal(job.application_language, 'pt');
  assert.equal(job.seniority, 'junior');
  assert.equal(job.date_posted, '2026-07-20');
  assert.equal(job.valid_through, '2026-08-20');
  assert.equal(job.employment_type, 'FULL_TIME');
  assert.equal(job.enrichment.has_compensation, false);
  assert.equal(job.enrichment.has_stack, true);
});

test('accepts a complete synthetic junior role', () => {
  const result = evaluateJobQuality({
    title: 'Junior Software Developer',
    company: 'Example Labs',
    link: 'https://jobs.example.test/roles/42',
    description: LONG_JUNIOR_DESCRIPTION,
    location: 'Lisboa',
    work_mode: 'Hybrid',
    compensation: 'Salary range published',
    source: 'synthetic fixture',
    stack_required: ['TypeScript'],
    is_active: true,
  }, DEFAULT_QUALITY_GATE);

  assert.equal(result.passed, true);
  assert.equal(result.quality_score, 100);
  assert.deepEqual(result.rejection_reasons, []);
});

test('rejects jobs without a description', () => {
  const result = evaluateJobQuality({
    title: 'Junior Developer',
    company: 'Example Labs',
    link: 'https://jobs.example.test/roles/42',
    description: '',
    location: 'Remote',
    work_mode: 'Remote',
    source: 'synthetic fixture',
    is_active: true,
  }, DEFAULT_QUALITY_GATE);

  assert.equal(result.passed, false);
  assert.equal(result.rejection_reasons.includes('no_description'), true);
  assert.equal(
    result.rejection_reasons.includes('quality_score_below_rank_minimum'),
    true,
  );
});

test('rejects experience-heavy technical roles without junior evidence', () => {
  const result = evaluateJobQuality({
    title: 'Software Engineer',
    company: 'Example Labs',
    link: 'https://jobs.example.test/roles/42',
    description: [
      'Build and operate a production software platform for global customers.',
      'This role requires 5+ years of proven experience and a computer science degree.',
      'You will own architecture, delivery, operations and technical decisions.',
    ].join(' '),
    location: 'Remote',
    work_mode: 'Remote',
    compensation: 'Salary range published',
    source: 'synthetic fixture',
    stack_required: ['TypeScript'],
    asks_years_experience: 5,
    is_active: true,
  }, DEFAULT_QUALITY_GATE);

  assert.equal(result.passed, false);
  assert.equal(
    result.rejection_reasons.includes('missing_junior_or_mentorship_signal'),
    true,
  );
  assert.equal(
    result.rejection_reasons.includes('experience_heavy_without_junior_signal'),
    true,
  );
});

test('accepts an entry path when concrete mentorship evidence is present', () => {
  const result = evaluateJobQuality({
    title: 'Software Developer',
    company: 'Example Labs',
    link: 'https://jobs.example.test/roles/42',
    description: LONG_JUNIOR_DESCRIPTION,
    location: 'Remote',
    work_mode: 'Remote',
    compensation: 'a confirmar',
    source: 'synthetic fixture',
    stack_required: ['TypeScript'],
    is_active: true,
  }, DEFAULT_QUALITY_GATE);

  assert.equal(result.passed, true);
  assert.equal(
    result.rejection_reasons.includes('missing_junior_or_mentorship_signal'),
    false,
  );
  assert.equal(result.warnings.includes('missing_compensation'), true);
});

test('accepts a bounded junior role phrase found in a generic board description', () => {
  const result = evaluateJobQuality(normalizeJob({
    title: 'Informática (Gestão de Redes) - Lisboa',
    company: 'Example Systems',
    link: 'https://jobs.example.test/roles/junior-systems',
    description: [
      'A empresa pretende integrar um/a Administrador/a de Sistemas Júnior.',
      'A função inclui apoio a utilizadores, Windows, Linux, redes e hardware.',
      'Aceita licenciatura ou Curso Profissional IV: Técnico de Informática.',
    ].join(' '),
    location: 'Lisboa',
    source: 'synthetic fixture',
    is_active: true,
  }), DEFAULT_QUALITY_GATE);

  assert.equal(result.passed, true);
  assert.equal(result.rejection_reasons.includes('experience_heavy_without_junior_signal'), false);
});

test('detects adapters and classifies source health deterministically', async (t) => {
  assert.deepEqual(detectSourceAdapter({
    api: 'https://tenant.example.test/wday/cxs/example/jobs',
  }), {
    adapter: 'workday_api',
    scanner: 'existing',
    reason: 'api field points to Workday CXS',
  });

  assert.deepEqual(detectSourceAdapter({
    url: 'https://careers.example.test/',
    adapter: 'custom platform',
  }), {
    adapter: 'custom_platform',
    scanner: 'needed',
    reason: 'explicit config',
  });

  const cases = [
    [{ enabled: false }, 'disabled'],
    [{ httpCode: 404 }, 'dead_url'],
    [{ httpCode: 403 }, 'blocked'],
    [{ httpCode: 429 }, 'rate_limited'],
    [{ httpCode: 503 }, 'server_error'],
    [{ httpCode: 302 }, 'redirect'],
    [{ error: 'request timeout' }, 'fetch_failed'],
    [{ httpCode: 200, adapter: 'custom', scanner: 'needed' }, 'needs_adapter'],
    [{ httpCode: 200, adapter: 'generic_html', scanner: 'existing' }, 'healthy'],
  ];

  for (const [input, expected] of cases) {
    await t.test(expected, () => {
      assert.equal(classifySourceHealth(input).status, expected);
    });
  }
});

test('uses generic HTML for a server-rendered SuccessFactors job listing', () => {
  const expected = {
    adapter: 'generic_html',
    scanner: 'existing',
    reason: 'server-rendered SuccessFactors job links',
  };
  const detection = detectSourceAdapter({
    url: 'https://careers.example.test/search/?locationsearch=Portugal',
    html: SUCCESSFACTORS_SERVER_RENDERED_HTML,
  });

  assert.deepEqual(detection, expected);
  assert.deepEqual(detectSourceAdapter({
    url: 'https://tenant.successfactors.example.test/career',
    html: SUCCESSFACTORS_SERVER_RENDERED_HTML,
  }), expected);
  assert.equal(classifySourceHealth({
    httpCode: 200,
    adapter: detection.adapter,
    scanner: detection.scanner,
  }).status, 'healthy');
});

test('keeps SuccessFactors adapter-needed when no server-rendered job links exist', () => {
  assert.deepEqual(detectSourceAdapter({
    url: 'https://careers.example.test/',
    html: `
      <main id="app"></main>
      <script src="/platform/js/search/search.js"></script>
      <script>window.platform = "SAP SuccessFactors";</script>
    `,
  }), {
    adapter: 'successfactors',
    scanner: 'needed',
    reason: 'html pattern',
  });
});
