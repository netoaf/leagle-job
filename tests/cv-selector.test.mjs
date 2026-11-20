import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  detectCvLanguage,
  detectCvVariant,
  selectCvForApplication,
} from '../lib/cv-selector.mjs';

test('selects Portuguese Automation/QA CV for a Portuguese QA vacancy', () => {
  const application = {
    role: 'QA Automático Junior',
    notes: 'Lisboa, híbrido',
  };
  const report = '**URL:** https://www.net-empregos.com/123/qa-automatico/';

  assert.equal(detectCvLanguage(application, report).value, 'pt');
  assert.equal(detectCvVariant(application).value, 'automation_qa');
});

test('selects English Full-stack CV for an international ATS vacancy', () => {
  const application = {
    role: 'Junior Full Stack Engineer',
    notes: 'Remote United Kingdom',
  };
  const report = '**URL:** https://jobs.ashbyhq.com/example/role-id';

  assert.equal(detectCvLanguage(application, report).value, 'en');
  assert.equal(detectCvVariant(application).value, 'fullstack');
});

test('English draft language overrides Portuguese tracker commentary', () => {
  const application = {
    role: 'Internship Program - Technology',
    notes: 'Excelente estrutura paga e híbrida; licenciatura a confirmar.',
  };
  const report = `
**URL:** https://www.linkedin.com/jobs/view/123

## Rascunho De Email
Subject: Application - Internship Program Technology

Hello,

I would like to apply for this internship.
`;

  assert.equal(detectCvLanguage(application, report).value, 'en');
});

test('notes can override both automatic decisions', () => {
  const application = {
    role: 'Backend Developer',
    notes: '[cv:en] [cv:automation-qa]',
  };

  assert.equal(detectCvLanguage(application, '').value, 'en');
  assert.equal(detectCvVariant(application).value, 'automation_qa');
});

test('does not disguise unrelated AI, data, support or DevOps roles as Automation/QA fit', () => {
  for (const role of [
    'Junior AI Engineer',
    'Data Analyst',
    'Technical Support Specialist',
    'Junior DevOps Engineer',
  ]) {
    assert.equal(detectCvVariant({ role }).value, 'backend');
    assert.match(detectCvVariant({ role }).reason, /profile default/);
  }
});

test('copies the selected CV and records auditable metadata', () => {
  const root = mkdtempSync(join(tmpdir(), 'jobfinder-cv-selector-'));
  try {
    const sourceRelative = 'output/cv-library/EN/CV-EN-Fullstack.pdf';
    const sourcePath = join(root, sourceRelative);
    mkdirSync(join(root, 'output', 'cv-library', 'EN'), { recursive: true });
    writeFileSync(sourcePath, 'fake-pdf-for-test');

    const selection = selectCvForApplication({
      application: {
        id: 58,
        company: 'Example Company',
        role: 'Junior Full Stack Engineer',
        notes: '[cv:en]',
      },
      projectRoot: root,
      profile: {
        documents: {
          cv_library: {
            en: { fullstack: sourceRelative },
          },
        },
      },
    });

    const destination = join(root, ...selection.selected_cv_pdf.split('/'));
    const metadata = destination.replace(/\.pdf$/i, '.selection.json');
    assert.equal(selection.status, 'ready for human review');
    assert.equal(readFileSync(destination, 'utf-8'), 'fake-pdf-for-test');
    assert.equal(existsSync(metadata), true);
    assert.equal(JSON.parse(readFileSync(metadata, 'utf-8')).human_review_required, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dry-run chooses a CV but writes no output', () => {
  const root = mkdtempSync(join(tmpdir(), 'jobfinder-cv-selector-dry-'));
  try {
    const sourceRelative = 'output/cv-library/PT/CV-PT-Backend.pdf';
    const sourcePath = join(root, sourceRelative);
    mkdirSync(join(root, 'output', 'cv-library', 'PT'), { recursive: true });
    writeFileSync(sourcePath, 'fake-pdf-for-test');

    const selection = selectCvForApplication({
      application: { id: 6, company: 'Empresa', role: 'Junior Developer' },
      projectRoot: root,
      dryRun: true,
      profile: {
        documents: {
          cv_library: {
            pt: { backend: sourceRelative },
          },
        },
      },
    });

    const destination = join(root, ...selection.selected_cv_pdf.split('/'));
    assert.equal(selection.language, 'pt');
    assert.equal(selection.variant, 'backend');
    assert.equal(selection.status, 'ready in library; copy skipped in dry-run');
    assert.equal(existsSync(destination), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
