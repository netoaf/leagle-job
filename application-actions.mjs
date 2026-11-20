#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { isActionableStatus, loadApplications, repairMojibakeText, selectApplications } from './lib/applications-store.mjs';
import { loadApplicationActions, upsertApplicationActions } from './lib/application-actions-store.mjs';
import { normalizeText, normalizeWhitespace, todayISO } from './lib/job-normalizer.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export function buildApplicationActions(options = {}) {
  const root = options.projectRoot || projectRoot;
  const allApplications = loadApplications(root);
  const applications = selectApplications(allApplications, options)
    .filter((application) => isActionableStatus(application.status));
  const existing = loadApplicationActions(root);
  const records = [];

  for (const application of applications) {
    const reportPath = resolve(root, application.report_path || '');
    const report = existsSync(reportPath) ? readFileSync(reportPath, 'utf-8') : '';
    const current = existing.get(application.report_number);
    const applyUrl = current?.apply_url && normalizeText(current.apply_url) !== 'a confirmar'
      ? current.apply_url
      : extractApplyUrl(report);
    const channel = current?.channel
      && normalizeText(current.channel) !== 'a confirmar'
      && normalizeText(current.channel) !== 'manual_apply_url'
      ? current.channel
      : inferApplicationChannel(applyUrl);
    const recipient = current?.recipient || 'a confirmar';
    const requestedStatus = extractActionStatus(application.notes);
    const status = requestedStatus || inferStatus({ report, applyUrl, channel, recipient });
    const blocker = buildBlocker({ application, report, applyUrl, channel, recipient, status });

    records.push({
      id: current?.id || String(application.id).padStart(3, '0'),
      application_id: String(application.id),
      report_number: application.report_number,
      company: cleanText(application.company),
      role: cleanText(application.role),
      channel,
      apply_url: applyUrl || 'a confirmar',
      recipient,
      status,
      blocker,
      next_action: buildNextAction(status, channel),
      created_at: current?.created_at || todayISO(),
      updated_at: todayISO(),
      notes: buildNotes(application),
    });
  }

  if (!options.dryRun) {
    upsertApplicationActions(root, records, {
      removeReportNumbers: allApplications
        .filter((application) => !isActionableStatus(application.status))
        .map((application) => application.report_number),
    });
  }

  return {
    dry_run: Boolean(options.dryRun),
    total_applications: allApplications.length,
    selected: records,
    store: resolve(root, 'data/application-actions.tsv'),
  };
}

function extractApplyUrl(report) {
  const text = String(report || '');
  const explicit = text.match(/^\*\*(?:URL|Apply URL|Link):\*\*\s*(https?:\/\/\S+)/im)
    || text.match(/^(?:URL|Apply URL|Link):\s*(https?:\/\/\S+)/im);
  if (explicit) return cleanUrl(explicit[1]);

  const firstUrl = text.match(/\bhttps?:\/\/[^\s)>\]]+/i);
  return firstUrl ? cleanUrl(firstUrl[0]) : '';
}

export function inferApplicationChannel(applyUrl) {
  if (!applyUrl) return 'needs_channel';
  let url;
  try {
    url = new URL(applyUrl);
  } catch {
    return 'manual_apply_url';
  }

  const host = normalizeText(url.hostname);
  if (host.includes('linkedin.com')) return 'linkedin_apply';
  if (['indeed.com', 'itjobs.pt', 'net-empregos.com'].some((domain) => host.includes(domain))) {
    return 'job_board_apply';
  }

  const officialPortalDomains = [
    'greenhouse.io',
    'lever.co',
    'ashbyhq.com',
    'workable.com',
    'myworkdayjobs.com',
    'smartrecruiters.com',
    'teamtailor.com',
    'successfactors.com',
    'eightfold.ai',
    'careers.',
    'jobs.',
    'recrutamento.',
  ];
  if (officialPortalDomains.some((domain) => host.includes(domain))) return 'official_portal';
  if (/\/(?:jobs?|careers?|recrutamento|talents?|join-us|apply)(?:\/|$)/i.test(url.pathname)) {
    return 'official_portal';
  }
  return 'manual_apply_url';
}

function inferStatus({ report, applyUrl, channel, recipient }) {
  if (!report) return 'blocked_missing_report';
  if (!applyUrl || normalizeText(channel) === 'needs_channel') return 'needs_channel';
  if (normalizeText(channel).includes('email') && normalizeText(recipient) === 'a confirmar') return 'needs_recipient';
  return 'ready_manual_review';
}

export function extractActionStatus(notes) {
  const marker = String(notes || '').match(/\[action:([a-z0-9_-]+)\]/i);
  return marker ? normalizeText(marker[1]).replace(/\s+/g, '_') : '';
}

function buildBlocker({ application, report, applyUrl, channel, recipient, status }) {
  const blockers = [];
  const text = normalizeText(`${application.notes}\n${report}`);
  if (!report) blockers.push('report em falta');
  if (!applyUrl) blockers.push('canal oficial a confirmar');
  if (normalizeText(channel).includes('email') && normalizeText(recipient) === 'a confirmar') blockers.push('email do recrutador a confirmar');
  if (status === 'needs_linkedin_verification') blockers.push('descrição, requisitos e canal têm de ser revistos numa sessão LinkedIn autenticada');
  if (status === 'needs_candidate_confirmation') {
    if (text.includes('iefp')) blockers.push('confirmar inscrição ativa no IEFP e ausência de estágio anterior do mesmo nível');
    blockers.push('confirmar equivalência da formação exigida antes de preencher');
  }
  return blockers.length ? unique(blockers).join('; ') : 'nenhum blocker operacional confirmado; rever os campos antes da submissão final';
}

export function buildNextAction(status, channel) {
  if (status === 'blocked_missing_report') return 'Regenerar ou corrigir report antes de preparar candidatura.';
  if (status === 'needs_channel') return 'Encontrar canal oficial de candidatura e confirmar que a vaga continua ativa.';
  if (status === 'needs_recipient') return 'Confirmar email do recrutador/empresa antes de criar draft real.';
  if (status === 'needs_linkedin_verification') return 'Abrir a vaga numa sessão LinkedIn autenticada e confirmar requisitos, localização e canal.';
  if (status === 'needs_candidate_confirmation') return 'Resolver as confirmações pessoais indicadas no blocker antes de preparar a candidatura.';
  if (status === 'ready_portal_prepare') return 'Preparar o formulário com dados confirmados e indicar o CV selecionado; parar antes do upload e da submissão final para revisão humana.';
  if (channel === 'linkedin_apply') return 'Abrir a vaga no LinkedIn, rever campos e indicar o CV selecionado; preencher apenas dados confirmados e parar antes do upload e do envio final.';
  if (channel === 'job_board_apply') return 'Abrir o job board, autenticar ou revelar o canal oficial, rever campos e indicar o CV selecionado; parar antes do upload e do envio final.';
  if (channel === 'official_portal') return 'Abrir o portal oficial, preencher campos confirmados e indicar o CV selecionado; parar antes do upload e da submissão final para aprovação humana.';
  if (normalizeText(channel).includes('email')) return 'Rever destinatario, corpo e CV no Gmail; enviar apenas apos aprovacao humana.';
  return 'Abrir o canal oficial, rever pack/CV e concluir manualmente apenas apos aprovacao humana.';
}

function buildNotes(application) {
  return cleanText(`${application.score || `${application.score_number}/100`} | ${application.notes || 'a confirmar'}`);
}

function cleanText(value) {
  return normalizeWhitespace(repairMojibakeText(value));
}

function cleanUrl(value) {
  return String(value || '').replace(/[.,;:]+$/, '').trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    id: '',
    top: 10,
    minScore: 70,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--id') options.id = argv[++index] || '';
    else if (arg === '--top') options.top = Number(argv[++index] || options.top);
    else if (arg === '--min-score') options.minScore = Number(argv[++index] || options.minScore);
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printResult(result) {
  console.log(`Application actions: ${result.selected.length}/${result.total_applications} selected.`);
  if (result.dry_run) console.log('Dry-run: no action tracker rows were written.');
  else console.log(`Store: ${relativePath(result.store)}`);

  for (const item of result.selected) {
    console.log(`- #${item.application_id.padStart(3, '0')} ${item.status} ${item.company} | ${item.role}`);
  }
}

function printHelp() {
  console.log(`
Usage: node application-actions.mjs [options]

Options:
  --dry-run             Preview action rows without writing.
  --id <ids>            Build rows for comma-separated application IDs.
  --top <number>        Build rows for top N actionable applications. Default: 10.
  --min-score <number>  Minimum tracker score for top mode. Default: 70.
`);
}

function relativePath(file) {
  return String(file || '').replace(`${projectRoot}\\`, '').replace(`${projectRoot}/`, '');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    printResult(buildApplicationActions(parseArgs(process.argv.slice(2))));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}
