import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildLocalEmailDrafts } from '../email-drafts.mjs';
import { todayISO } from '../lib/job-normalizer.mjs';

test('local email drafts plan the CV selected for each application instead of one global CV', () => {
  const root = mkdtempSync(join(tmpdir(), 'jobfinder-email-cv-'));
  try {
    for (const directory of [
      'config',
      'data',
      'reports',
      'output/cv-library/PT',
      'output/cv-library/EN',
    ]) {
      mkdirSync(join(root, directory), { recursive: true });
    }

    writeFileSync(join(root, 'config', 'profile.yml'), `
documents:
  current_cv_pdf: "output/cv-library/PT/CV-PT-Backend.pdf"
  cv_library:
    pt:
      backend: "output/cv-library/PT/CV-PT-Backend.pdf"
    en:
      fullstack: "output/cv-library/EN/CV-EN-Fullstack.pdf"
  cv_selection:
    default_language: "pt"
    default_variant: "backend"
`, 'utf-8');
    writeFileSync(join(root, 'config', 'scoring.yml'), '', 'utf-8');
    writeFileSync(join(root, 'config', 'jobfinder-rules.yml'), '', 'utf-8');
    writeFileSync(join(root, 'config', 'email.yml'), `
enabled: false
mode: "draft_only"
human_review_required: true
auto_send: false
attachments:
  planned_cv_pdf: "output/cv-library/PT/CV-PT-Backend.pdf"
  require_explicit_attachment_approval: true
safety:
  require_draft_quality_gate: true
  require_recipient_confirmed: true
  require_application_pack: true
  require_vacancy_verified: true
  vacancy_verification_max_age_days: 7
  never_send_without_approval: true
`, 'utf-8');

    writeFileSync(join(root, 'output', 'cv-library', 'PT', 'CV-PT-Backend.pdf'), 'pt-backend');
    writeFileSync(join(root, 'output', 'cv-library', 'EN', 'CV-EN-Fullstack.pdf'), 'en-fullstack');
    writeFileSync(join(root, 'reports', '007.md'), `
## Email Draft
Subject: Application for Junior Full Stack Developer

Hello,

I would like to apply.
`, 'utf-8');
    writeFileSync(join(root, 'reports', '008.md'), `
## Rascunho de Email
Assunto: Candidatura a Programador Backend

Olá,

Gostaria de apresentar a minha candidatura.
`, 'utf-8');
    writeFileSync(join(root, 'data', 'applications.md'), `
| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---:|---|---|---|---:|---|---|---|---|
| 7 | 2026-08-05 | Example Ltd | Junior Full Stack Developer | 92 | Evaluated | | [7](reports/007.md) | [cv:en] [verified:${todayISO()}] |
| 8 | 2026-08-05 | Empresa PT | Programador Backend | 91 | Evaluated | | [8](reports/008.md) | [cv:pt] [verified:${todayISO()}] |
`, 'utf-8');

    const result = buildLocalEmailDrafts({
      projectRoot: root,
      dryRun: true,
      top: 10,
      to: 'recruitment@example.com',
    });

    assert.equal(result.selected.length, 2);
    const fullstack = result.selected.find((item) => item.application.id === 7);
    const backend = result.selected.find((item) => item.application.id === 8);
    assert.equal(fullstack.record.planned_attachment, 'output/cv-library/EN/CV-EN-Fullstack.pdf');
    assert.equal(backend.record.planned_attachment, 'output/cv-library/PT/CV-PT-Backend.pdf');
    assert.equal(fullstack.record.status, 'local_ready');
    assert.equal(backend.record.status, 'local_ready');
    assert.match(fullstack.markdown, /CV preselection: EN \/ Full-stack/);
    assert.match(backend.markdown, /CV preselection: PT \/ Backend/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('local email draft stays blocked until the official vacancy is recently verified', () => {
  const root = mkdtempSync(join(tmpdir(), 'jobfinder-email-verification-'));
  try {
    for (const directory of ['config', 'data', 'reports', 'output/cv-library/PT']) {
      mkdirSync(join(root, directory), { recursive: true });
    }
    writeFileSync(join(root, 'config', 'profile.yml'), `
documents:
  cv_library:
    pt:
      backend: "output/cv-library/PT/CV-PT-Backend.pdf"
`, 'utf-8');
    writeFileSync(join(root, 'config', 'scoring.yml'), '', 'utf-8');
    writeFileSync(join(root, 'config', 'jobfinder-rules.yml'), '', 'utf-8');
    writeFileSync(join(root, 'config', 'email.yml'), `
mode: "draft_only"
human_review_required: true
auto_send: false
safety:
  require_vacancy_verified: true
  vacancy_verification_max_age_days: 7
  never_send_without_approval: true
`, 'utf-8');
    writeFileSync(join(root, 'output', 'cv-library', 'PT', 'CV-PT-Backend.pdf'), 'pt-backend');
    writeFileSync(join(root, 'reports', '009.md'), `
## Rascunho de Email
Assunto: Candidatura

Olá, gostaria de apresentar a minha candidatura.
`, 'utf-8');
    writeFileSync(join(root, 'data', 'applications.md'), `
| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
| 9 | 2026-07-01 | Empresa | Programador Backend | 90 | Evaluated | | [9](reports/009.md) | [cv:pt] |
`, 'utf-8');

    const result = buildLocalEmailDrafts({
      projectRoot: root,
      dryRun: true,
      to: 'recruitment@example.com',
    });
    assert.equal(result.selected[0].record.status, 'blocked_unverified_vacancy');
    assert.match(result.selected[0].markdown, /missing \[verified:YYYY-MM-DD\] tracker marker/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
