#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadJobFinderConfigs } from './lib/config-loader.mjs';
import { enrichJob } from './lib/job-enrichment.mjs';
import { normalizeWhitespace, slugify, stripHtml, todayISO } from './lib/job-normalizer.mjs';
import { evaluateJobFit } from './job-scoring-service.mjs';
import { evaluateJobQuality, loadQualityGateConfig } from './lib/job-quality-gate.mjs';
import { runScanAndRank } from './scan-and-rank.mjs';
import { extractJobDescriptionMax } from './lib/job-description-extractor.mjs';
import {
  browserAgentPolicySummary,
  loadBrowserAgentConfig,
  validateBrowserAgentConfig,
} from './lib/browser-agent/safety.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.url) {
    printUsage();
    process.exit(1);
  }

  const browserConfig = loadBrowserAgentConfig(projectRoot);
  const browserValidation = validateBrowserAgentConfig(browserConfig);
  if (browserValidation.errors.length > 0) {
    throw new Error(`Browser agent config invalid:\n- ${browserValidation.errors.join('\n- ')}`);
  }

  const configs = loadJobFinderConfigs(projectRoot);
  const qualityConfig = loadQualityGateConfig(projectRoot);

  const extraction = await extractJobDescriptionMax({
    projectRoot,
    url: options.url,
    browserConfig,
    visible: options.visible,
    write: false,
  });

  const job = enrichJob({
    ...extraction.job,
    http_status: extraction.http_status,
    source: extraction.job.source || 'evaluate-url browser-agent',
  });
  const quality = evaluateJobQuality(job, qualityConfig);
  const evaluation = quality.passed
    ? evaluateJobFit({ ...job, quality_gate: quality }, configs)
    : null;

  let artifacts = null;
  if (options.write) {
    artifacts = writeEvaluateUrlArtifacts(projectRoot, {
      extraction,
      job,
      quality,
      evaluation,
      browser_policy: browserAgentPolicySummary(browserConfig),
    });
  }

  let dashboard = null;
  if (options.dashboard) {
    dashboard = await runScanAndRank({
      projectRoot,
      dryRun: false,
      snapshot: {
        scanned_at: extraction.extracted_at,
        scan_mode: 'evaluate-url',
        candidates: [job],
        skipped: [],
        errors: [],
        source_stats: [{
          source: 'evaluate-url',
          type: 'browser_agent',
          discovered: 1,
          accepted: 1,
          skipped: 0,
        }],
      },
      minScore: options.minScore,
      writeLimit: 1,
      writeGuardMode: 'dashboard_only',
    });
  }

  printResult({ extraction, job, quality, evaluation, artifacts, dashboard }, options.json);
}

function parseArgs(argv) {
  const options = {
    url: '',
    visible: false,
    write: false,
    dashboard: false,
    json: false,
    minScore: undefined,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--url') options.url = argv[++index] || '';
    else if (arg === '--visible') options.visible = true;
    else if (arg === '--write') options.write = true;
    else if (arg === '--dashboard') options.dashboard = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--min-score') options.minScore = Number(argv[++index]);
    else if (!options.url && /^https?:\/\//i.test(arg)) options.url = arg;
    else if (!options.url && /^data:/i.test(arg)) options.url = arg;
  }

  return options;
}

function writeEvaluateUrlArtifacts(root, payload) {
  const dir = join(root, 'output', 'evaluate-url');
  mkdirSync(dir, { recursive: true });
  const job = payload.job || {};
  const label = slugify(`${job.company || 'company'}-${job.title || 'job'}`);
  const base = `${todayISO()}-${label}`;
  const jsonPath = join(dir, `${base}.json`);
  const mdPath = join(dir, `${base}.md`);

  writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf-8');
  writeFileSync(mdPath, renderMarkdown(payload), 'utf-8');
  return { json: jsonPath, markdown: mdPath };
}

function renderMarkdown(payload) {
  const job = payload.job || {};
  const quality = payload.quality || {};
  const evaluation = payload.evaluation || {};
  return `# Evaluate URL

URL: ${payload.extraction?.final_url || payload.extraction?.requested_url || job.link || 'a confirmar'}
Extracted: ${payload.extraction?.extracted_at || 'a confirmar'}

## Job

- Company: ${job.company || 'a confirmar'}
- Title: ${job.title || 'a confirmar'}
- Location: ${job.location || 'a confirmar'}
- Work mode: ${job.work_mode || 'a confirmar'}
- Source: ${job.source || 'a confirmar'}

## Quality

- Passed: ${quality.passed === true}
- Quality score: ${quality.quality_score ?? 'a confirmar'}
- Rejection reasons: ${asArray(quality.rejection_reasons).join(', ') || 'none'}
- Warnings: ${asArray(quality.warnings).join(', ') || 'none'}

## Score

- Score: ${evaluation.score ?? 'not scored'}
- Recommendation: ${evaluation.recommendation || 'not scored'}
- Red flags: ${asArray(evaluation.red_flags).join(', ') || 'none'}
- Hard blockers: ${asArray(evaluation.hard_blockers_triggered).join(', ') || 'none'}

## Description

${normalizeWhitespace(stripHtml(job.description || '')).slice(0, 12000) || 'a confirmar'}

## Next Action

${evaluation.next_action || 'Review quality gate result before deciding.'}
`;
}

function printResult(result, asJson) {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const { extraction, job, quality, evaluation, artifacts, dashboard } = result;
  console.log('\nEvaluate URL complete');
  console.log(`URL: ${extraction.final_url || extraction.requested_url}`);
  console.log(`HTTP: ${extraction.http_status || 'a confirmar'}`);
  console.log(`Company: ${job.company}`);
  console.log(`Title: ${job.title}`);
  console.log(`Location: ${job.location}`);
  console.log(`Work mode: ${job.work_mode}`);
  console.log(`Description chars: ${String(job.description || '').length}`);
  console.log(`Forms detected: ${extraction.forms.length}`);
  console.log(`Apply links detected: ${extraction.apply_links.length}`);
  console.log(`Quality: ${quality.passed ? 'passed' : 'failed'} (${quality.quality_score}/100)`);
  if (quality.rejection_reasons.length > 0) console.log(`Quality blockers: ${quality.rejection_reasons.join(', ')}`);
  if (quality.warnings.length > 0) console.log(`Quality warnings: ${quality.warnings.join(', ')}`);

  if (evaluation) {
    console.log(`Score: ${evaluation.score}/100`);
    console.log(`Recommendation: ${evaluation.recommendation}`);
    console.log(`Red flags: ${evaluation.red_flags.join(', ') || 'none'}`);
    console.log(`Next action: ${evaluation.next_action}`);
  } else {
    console.log('Score: not scored because quality gate failed.');
  }

  if (artifacts) {
    console.log(`Artifacts JSON: ${artifacts.json}`);
    console.log(`Artifacts Markdown: ${artifacts.markdown}`);
  } else {
    console.log('Artifacts: not written. Add --write to save evaluation files.');
  }

  if (dashboard) {
    if (dashboard.written.length > 0) {
      console.log('\nDashboard writes:');
      for (const item of dashboard.written) {
        console.log(`- #${item.id} ${item.company} | ${item.title} | ${item.score}/100`);
      }
    } else {
      console.log('\nDashboard writes: none.');
    }
    if (dashboard.write_skipped.length > 0) {
      console.log('Dashboard skipped:');
      for (const item of dashboard.write_skipped) console.log(`- ${item.company} | ${item.title} | ${item.reason}`);
    }
  } else {
    console.log('Dashboard: not updated. Add --dashboard to promote selected jobs.');
  }
}

function printUsage() {
  console.log(`
Usage:
  node evaluate-url.mjs --url "https://example.com/job"
  node evaluate-url.mjs --url "https://example.com/job" --write
  node evaluate-url.mjs --url "https://example.com/job" --write --dashboard

Flags:
  --write       Save extraction + scoring artifacts under output/evaluate-url/
  --dashboard   Promote selected jobs to reports/ and data/applications.md
  --visible     Open a visible browser for debugging
  --json        Print JSON output
  --min-score N Override dashboard write threshold

Safety:
  Browser agent is extraction-only. It does not fill forms, upload CVs or submit applications.
`);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

main().catch((error) => {
  console.error(`\nEvaluate URL failed: ${error.message}`);
  process.exit(1);
});
