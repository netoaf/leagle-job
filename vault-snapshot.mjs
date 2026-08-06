#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadApplications, summarizeApplications } from './lib/applications-store.mjs';
import { summarizeApplicationActions } from './lib/application-actions-store.mjs';
import { normalizeText, todayISO } from './lib/job-normalizer.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const DEFAULT_VAULT_DIR = resolve(projectRoot, '..', '..', 'obsidian_vault');
const SNAPSHOT_FILE = '14 - Pipeline Snapshot.md';

export function buildVaultSnapshot(options = {}) {
  const root = options.projectRoot || projectRoot;
  const vaultDir = resolve(options.vaultDir || DEFAULT_VAULT_DIR);
  const applications = loadApplications(root);
  const summary = summarizeApplications(applications);
  const followups = loadFollowups(root);
  const applicationActions = summarizeApplicationActions(root);
  const emailDrafts = loadEmailDrafts(root);
  const sourceHealth = loadSourceHealth(root);
  const markdown = renderSnapshot({
    applications,
    summary,
    followups,
    applicationActions,
    emailDrafts,
    sourceHealth,
  });
  const output = join(vaultDir, SNAPSHOT_FILE);

  if (!options.dryRun) {
    mkdirSync(vaultDir, { recursive: true });
    writeFileSync(output, markdown, 'utf-8');
  }

  return {
    dry_run: Boolean(options.dryRun),
    vault_dir: vaultDir,
    output,
    applications: applications.length,
    markdown,
  };
}

function renderSnapshot({ applications, summary, followups, applicationActions, emailDrafts, sourceHealth }) {
  const latestReport = latestApplication(applications);
  const top = summary.top.slice(0, 12);
  const recent = recentActionable(applications).slice(0, 8);
  const caution = cautionItems(applications).slice(0, 6);

  return `# Pipeline Snapshot

Snapshot gerado automaticamente a partir de \`data/applications.md\` em ${todayISO()}.
Usar como orientacao rapida, nao como fonte final. A fonte viva continua a ser
o tracker, os reports e os ficheiros em \`config/\`.

## Estado Atual

- Entradas no tracker: ${summary.total}.
- Evaluated: ${summary.evaluated}.
- Applied: ${summary.applied}.
- Interview: ${summary.interview}.
- Skip: ${summary.skip}.
- Actionable ainda por decidir: ${summary.actionable}.
- Follow-up records: ${followups.total}.
- Follow-ups vencidos: ${followups.due}.
- Application actions: ${applicationActions.total}${applicationActions.total ? ` (${statusSummary(applicationActions.counts)}).` : '.'}
- Email drafts locais: ${emailDrafts.total}${emailDrafts.total ? ` (${emailDraftStatusSummary(emailDrafts)}).` : '.'}
- Reports recentes: ${latestReport ? `ate \`${latestReport.report_path || latestReport.report_number}\`.` : 'a confirmar.'}
- Source-health: ${sourceHealth.total ? sourceHealthSummary(sourceHealth) : 'a confirmar.'}

## Top Prioridades Por Score

${topTable(top)}

## Prioridades Recentes Para Rever

${recentList(recent)}

## Vagas A Tratar Com Cuidado

${cautionList(caution)}

## Proxima Acao Recomendada

1. Abrir [[09 - Dashboard And Follow Ups]].
2. Rever reports das top 5 antes de qualquer candidatura.
3. Correr:

\`\`\`powershell
npm.cmd run top10-action
npm.cmd run draft-quality
\`\`\`

4. Gerar CV diff apenas se a vaga justificar:

\`\`\`powershell
npm.cmd run cv-tailor-diff -- --top 10
\`\`\`

5. So depois preparar candidatura manual.

## Ligacoes

- [[11 - Reports Pipeline]]
- [[10 - Candidate Context]]
- [[08 - Safety And Quality Gates]]

Tags: #jobfinder #snapshot #pipeline
`;
}

function latestApplication(applications) {
  return [...applications].sort((a, b) => b.id - a.id)[0] || null;
}

function topTable(applications) {
  if (applications.length === 0) return 'Nenhuma vaga pontuada no tracker.';
  const rows = [
    '| Score | Empresa | Role | Nota rapida |',
    '| --- | --- | --- | --- |',
  ];
  for (const app of applications) {
    rows.push(`| ${app.score || `${app.score_number}/100`} | ${escapeCell(app.company)} | ${escapeCell(app.role)} | ${snapshotNote(app)} |`);
  }
  return rows.join('\n');
}

function recentList(applications) {
  if (applications.length === 0) return '- Nenhuma prioridade recente acionavel encontrada.';
  return applications
    .map((app) => `- ${asciiSafe(app.company)}: ${asciiSafe(app.role)}, ${app.score || `${app.score_number}/100`}.`)
    .join('\n');
}

function cautionList(applications) {
  if (applications.length === 0) {
    return '- Rever reports com muitos `a confirmar`, roles globais stretch e requisitos de lingua/localizacao.';
  }
  return applications
    .map((app) => `- ${asciiSafe(app.company)}: ${asciiSafe(app.role)} (${asciiSafe(app.status)}) - ${trimNote(app.notes)}`)
    .join('\n');
}

function recentActionable(applications) {
  const latestDate = [...applications].map((app) => app.date).filter(Boolean).sort().at(-1) || '';
  return applications
    .filter((app) => app.date === latestDate)
    .filter((app) => app.score_number >= 70)
    .filter((app) => !['skip', 'rejected', 'discarded', 'applied', 'interview', 'offer'].includes(normalizeText(app.status)))
    .sort((a, b) => b.score_number - a.score_number || a.id - b.id);
}

function cautionItems(applications) {
  return applications
    .filter((app) => normalizeText(app.status).includes('skip') || normalizeText(app.notes).includes('confirmar'))
    .sort((a, b) => b.score_number - a.score_number || a.id - b.id);
}

function snapshotNote(app) {
  const text = normalizeText(`${app.role} ${app.notes}`);
  if (text.includes('confirmar')) return 'Forte, mas confirmar requisitos antes de aplicar.';
  if (text.includes('stretch')) return 'Boa oportunidade, mas pode ser stretch tecnico.';
  if (text.includes('skip')) return 'Rever apenas se houver novo sinal ativo.';
  if (app.score_number >= 85) return 'Prioridade alta; ler report antes de aplicar.';
  if (app.score_number >= 75) return 'Boa candidata; validar red flags.';
  return 'Rever contexto antes de decidir.';
}

function trimNote(value) {
  const text = asciiSafe(value || 'a confirmar').trim();
  return text.length <= 110 ? text : `${text.slice(0, 107).trim()}...`;
}

function escapeCell(value) {
  return asciiSafe(value || 'a confirmar').replace(/\|/g, '/').trim();
}

function asciiSafe(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '')
    .trim();
}

function loadFollowups(root) {
  const file = join(root, 'data', 'application-followups.tsv');
  const result = { total: 0, due: 0 };
  if (!existsSync(file)) return result;
  const today = todayISO();
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim() || line.startsWith('id\t')) continue;
    result.total += 1;
    const fields = line.split('\t');
    if (fields[6] && fields[6] <= today) result.due += 1;
  }
  return result;
}

function loadEmailDrafts(root) {
  const file = join(root, 'data', 'email-drafts.tsv');
  const result = { total: 0, counts: {} };
  if (!existsSync(file)) return result;
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim() || line.startsWith('id\t')) continue;
    const fields = line.split('\t');
    const status = fields[5] || 'unknown';
    result.total += 1;
    result.counts[status] = (result.counts[status] || 0) + 1;
  }
  return result;
}

function emailDraftStatusSummary(emailDrafts) {
  return statusSummary(emailDrafts.counts);
}

function statusSummary(counts) {
  return Object.entries(counts || {})
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `${status} ${count}`)
    .join(', ');
}

function loadSourceHealth(root) {
  const file = join(root, 'data', 'source-health.tsv');
  const counts = {};
  if (!existsSync(file)) return { total: 0, counts };
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim() || line.startsWith('source\t') || line.startsWith('company\t')) continue;
    const fields = line.split('\t');
    const status = fields[5] || 'unknown';
    counts[status] = (counts[status] || 0) + 1;
  }
  return {
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    counts,
  };
}

function sourceHealthSummary(sourceHealth) {
  const entries = Object.entries(sourceHealth.counts)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `${status} ${count}`);
  return `${sourceHealth.total} fontes (${entries.join(', ')}).`;
}

function parseArgs(argv) {
  const options = { dryRun: false, vaultDir: '' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--vault') options.vaultDir = argv[++index] || '';
  }
  return options;
}

function printResult(result) {
  console.log(`Vault snapshot: ${result.applications} applications.`);
  if (result.dry_run) console.log('Dry-run: snapshot was not written.');
  else console.log(`Updated: ${relativePath(result.output)}`);
}

function relativePath(file) {
  return String(file || '').replace(`${projectRoot}\\`, '').replace(`${projectRoot}/`, '');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  printResult(buildVaultSnapshot(parseArgs(process.argv.slice(2))));
}
