#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { buildApplicationPacks } from './application-pack.mjs';
import { normalizeWhitespace, todayISO } from './lib/job-normalizer.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export function buildTop10ActionMode(options = {}) {
  const root = options.projectRoot || projectRoot;
  const top = Number(options.top || 10);
  const minScore = Number(options.minScore || 70);
  const packs = buildApplicationPacks({
    projectRoot: root,
    top,
    minScore,
    dryRun: options.dryRun,
  });
  const followups = loadFollowups(root);
  const markdown = buildActionPlanMarkdown(packs, followups);
  const outputDir = resolve(root, options.outputDir || join('output', 'top10-action-mode'));
  const outputPath = join(outputDir, `top10-action-plan-${todayISO()}.md`);

  if (!options.dryRun) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(outputPath, markdown, 'utf-8');
  }

  return {
    dry_run: Boolean(options.dryRun),
    selected: packs.selected,
    packs_output_dir: packs.output_dir,
    output: outputPath,
    markdown,
  };
}

function buildActionPlanMarkdown(packs, followups) {
  const lines = [
    '# Leagle Job Top 10 Action Mode',
    '',
    `Generated: ${todayISO()}`,
    '',
    'Purpose: turn the strongest evaluated vacancies into reviewed, honest, manual applications with controlled follow-up.',
    '',
    'Safety rules:',
    '',
    '- Do not send automatically.',
    '- Do not upload CV automatically.',
    '- Do not submit forms automatically.',
    '- Do not invent experience, projects, certificates, metrics, links or clients.',
    '- Keep the candidate positioned as junior/intern.',
    '- Anything uncertain stays as `a confirmar`.',
    '',
    'Global checklist:',
    '',
    '- [ ] Run `npm.cmd run draft-quality` after packs are generated.',
    '- [ ] Confirm phone, portfolio/demo URL and availability before using them.',
    '- [ ] Confirm work mode, compensation/stipend and eligibility for each role.',
    '- [ ] Create CV tailoring diff before generating or sending a tailored CV.',
    '- [ ] Submit applications manually only after review.',
    '- [ ] Mark submitted jobs as `Applied` in the dashboard.',
    '- [ ] Check that follow-up due dates appear in the dashboard.',
    '',
    '## Top Applications',
    '',
  ];

  if (packs.selected.length === 0) {
    lines.push('No actionable applications matched the current Top 10 criteria.');
    return lines.join('\n');
  }

  for (const item of packs.selected) {
    const reportNumber = String(item.id).padStart(3, '0');
    const followup = followups.get(reportNumber) || {};
    lines.push(`### #${reportNumber} - ${item.company} - ${item.role}`);
    lines.push('');
    lines.push(`- Score: ${item.score}/100`);
    lines.push(`- Report: ${item.report || 'a confirmar'}`);
    lines.push(`- Pack: ${relativePath(item.output)}`);
    lines.push(`- Follow-up due: ${followup.followup_due || 'only after manual application'}`);
    lines.push(`- Next action: ${followup.next_action || 'Review pack, tailor CV safely, then apply manually or skip.'}`);
    lines.push('');
    lines.push('Checklist:');
    lines.push('');
    lines.push('- [ ] Read report and confirm recommendation still makes sense.');
    lines.push('- [ ] Review red flags and hard blockers.');
    lines.push('- [ ] Confirm eligibility, work mode and compensation/stipend.');
    lines.push('- [ ] Review email draft language and claims.');
    lines.push('- [ ] Generate/review CV tailoring diff if needed.');
    lines.push('- [ ] Submit manually if approved.');
    lines.push('- [ ] Change status to `Applied` in dashboard after submission.');
    lines.push('- [ ] Follow-up according to dashboard date.');
    lines.push('');
  }

  return lines.join('\n');
}

function loadFollowups(root) {
  const file = join(root, 'data', 'application-followups.tsv');
  const records = new Map();
  if (!existsSync(file)) return records;
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim() || line.startsWith('id\t')) continue;
    const fields = line.split('\t');
    while (fields.length < 12) fields.push('');
    records.set(fields[1] || fields[0], {
      id: fields[0],
      report_number: fields[1],
      followup_due: fields[6],
      next_action: fields[9],
    });
  }
  return records;
}

function relativePath(file) {
  return normalizeWhitespace(String(file || '').replace(`${projectRoot}\\`, '').replace(`${projectRoot}/`, ''));
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    top: 10,
    minScore: 70,
    outputDir: '',
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--top') options.top = Number(argv[++index] || options.top);
    else if (arg === '--min-score') options.minScore = Number(argv[++index] || options.minScore);
    else if (arg === '--out') options.outputDir = argv[++index] || '';
  }
  return options;
}

function printResult(result) {
  console.log(`Top 10 action mode: ${result.selected.length} selected.`);
  if (result.dry_run) {
    console.log('Dry-run: no packs or action plan were written.');
  } else {
    console.log(`Action plan: ${relativePath(result.output)}`);
    console.log(`Packs: ${relativePath(result.packs_output_dir)}`);
  }
  for (const item of result.selected) {
    console.log(`- #${String(item.id).padStart(3, '0')} ${item.score}/100 ${item.company} | ${item.role}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  printResult(buildTop10ActionMode(parseArgs(process.argv.slice(2))));
}
