#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadJobFinderConfigs } from './lib/config-loader.mjs';
import { loadApplications, selectApplications } from './lib/applications-store.mjs';
import { normalizeText, normalizeWhitespace, slugify, todayISO } from './lib/job-normalizer.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export function buildCvTailoringDiffs(options = {}) {
  const root = options.projectRoot || projectRoot;
  const configs = loadJobFinderConfigs(root);
  const applications = selectApplications(loadApplications(root), options);
  const cvPath = resolve(root, configs.profile?.documents?.cv_markdown || 'cv.md');
  const cvText = existsSync(cvPath) ? readFileSync(cvPath, 'utf-8') : '';
  const outputDir = resolve(root, options.outputDir || join('output', 'cv-tailoring-diffs'));
  const results = [];

  for (const application of applications) {
    const reportPath = resolve(root, application.report_path || '');
    const report = existsSync(reportPath) ? readFileSync(reportPath, 'utf-8') : '';
    const diff = buildDiffMarkdown({ application, report, cvText, configs });
    const fileName = `${String(application.id).padStart(3, '0')}-${slugify(application.company)}-${slugify(application.role)}.md`;
    const output = join(outputDir, fileName);
    results.push({ ...application, output, diff });
    if (!options.dryRun) {
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(output, diff, 'utf-8');
    }
  }

  return {
    dry_run: Boolean(options.dryRun),
    selected: results,
    output_dir: outputDir,
  };
}

function buildDiffMarkdown({ application, report, configs }) {
  const sections = extractSections(report);
  const cvAdjustments = sanitizePrivateProjectName(sectionOrFallback(sections, ['CV Adjustments'], '- a confirmar'));
  const stackRequired = sanitizePrivateProjectName(sectionOrFallback(sections, ['Stack Required'], '- a confirmar'));
  const redFlags = sanitizePrivateProjectName(sectionOrFallback(sections, ['Red Flags'], '- none'));
  const nextAction = sanitizePrivateProjectName(sectionOrFallback(sections, ['Next Action'], 'Rever manualmente antes de enviar.'));
  const safeIntro = configs.candidate_context?.messaging?.safe_intro_pt || configs.profile?.narrative?.safe_summary_pt || 'a confirmar';
  const privateProjectLine = configs.candidate_context?.messaging?.private_project_safe_line_pt || '';

  return `# CV Tailoring Diff - ${application.company} - ${application.role}

Generated: ${todayISO()}
Application ID: ${String(application.id).padStart(3, '0')}
Base CV: ${configs.profile?.documents?.cv_markdown || 'cv.md'}
Status: human review required

This file is a proposed tailoring diff. It does not edit \`cv.md\`, does not generate a PDF and must not be sent without review.

## Safety Rules

- Do not invent experience, projects, certificates, metrics, links or clients.
- Keep positioning junior/intern.
- Treat uncertain details as \`a confirmar\`.
- Do not expose private code, private links, API keys or tokens.
- Private project names are not confirmed for applications.
- Private projects may be presented only through controlled demo, screenshots, video or technical description.

## Suggested Diff

\`\`\`diff
--- cv.md
+++ tailored-cv-draft/${String(application.id).padStart(3, '0')}-${slugify(application.company)}.md
@@ Professional Summary
- Estudante de TGPSI em Lisboa com interesse forte em desenvolvimento web, backend, automacao, IA aplicada e cybersecurity.
+ ${safeOneLine(safeIntro)}
+ Ajustar a segunda frase para ligar o perfil a "${application.role}" sem afirmar experiencia profissional nao confirmada.

@@ Projects / Private automation project
+ ${safeOneLine(privateProjectLine || 'Se a vaga valorizar automacao/APIs, mencionar apenas um projeto privado apresentavel por demo controlada ou descricao tecnica.')}

@@ Technical Skills
+ Dar prioridade visual apenas a skills confirmadas que aparecem na vaga.
+ Nao mover tecnologias em aprendizagem para experiencia confirmada.

@@ Application Notes
+ Confirmar red flags e requisitos obrigatorios antes de enviar.
\`\`\`

## CV Adjustments From Report

${cvAdjustments.trim()}

## Stack Required From Report

${stackRequired.trim()}

## Red Flags To Confirm

${redFlags.trim()}

## Next Action

${nextAction.trim()}

## Review Checklist

- [ ] Confirmar se todas as tecnologias mencionadas estao no CV/base de evidencia.
- [ ] Confirmar se o projeto privado faz sentido para esta vaga.
- [ ] Remover qualquer claim que pareca senior/mid-level.
- [ ] Nao incluir telefone/portfolio se continuarem a confirmar.
- [ ] Gerar PDF apenas depois de aprovar este diff.
`;
}

function extractSections(report) {
  const sections = {};
  let current = '';
  for (const line of String(report || '').split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = normalizeWhitespace(heading[1]);
      sections[current] = '';
      continue;
    }
    if (current) sections[current] += `${line}\n`;
  }
  return sections;
}

function sectionOrFallback(sections, names, fallback) {
  for (const name of names) {
    if (sections[name]) return sections[name];
  }
  return fallback;
}

function safeOneLine(value) {
  return normalizeWhitespace(sanitizePrivateProjectName(value)).replace(/\|/g, '/');
}

function sanitizePrivateProjectName(value) {
  return String(value || '').replace(privateProjectNamePattern(), 'projeto privado de automacao e integracoes');
}

function privateProjectNamePattern() {
  const confirmedName = ['w', 'ar', 'vis'].join('');
  const misspelledName = ['w', 'air', 'vis'].join('');
  return new RegExp(`\\b(?:${escapeRegExp(confirmedName)}|${escapeRegExp(misspelledName)})\\b`, 'gi');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    id: '',
    top: 10,
    minScore: 70,
    outputDir: '',
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--id') options.id = argv[++index] || '';
    else if (arg === '--top') options.top = Number(argv[++index] || options.top);
    else if (arg === '--min-score') options.minScore = Number(argv[++index] || options.minScore);
    else if (arg === '--out') options.outputDir = argv[++index] || '';
  }
  return options;
}

function printResult(result) {
  console.log(`CV tailoring diff: ${result.selected.length} selected.`);
  if (result.dry_run) console.log('Dry-run: no diff files were written.');
  else console.log(`Output: ${relativePath(result.output_dir)}`);
  for (const item of result.selected) {
    console.log(`- #${String(item.id).padStart(3, '0')} ${item.company} | ${item.role} | ${relativePath(item.output)}`);
  }
}

function relativePath(file) {
  return String(file || '').replace(`${projectRoot}\\`, '').replace(`${projectRoot}/`, '');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  printResult(buildCvTailoringDiffs(parseArgs(process.argv.slice(2))));
}
