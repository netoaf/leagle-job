#!/usr/bin/env node

import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadJobFinderConfigs } from './lib/config-loader.mjs';
import { evaluateJobFit } from './job-scoring-service.mjs';
import { extractJobWithPlaywright } from './lib/browser-agent/playwright-agent.mjs';
import {
  browserAgentPolicySummary,
  loadBrowserAgentConfig,
  validateBrowserAgentConfig,
} from './lib/browser-agent/safety.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = loadBrowserAgentConfig(projectRoot);
  const validation = validateBrowserAgentConfig(config);

  if (options.check) {
    printCheck(config, validation);
    process.exit(validation.errors.length > 0 ? 1 : 0);
  }

  if (validation.errors.length > 0) {
    throw new Error(`Browser agent config invalid:\n- ${validation.errors.join('\n- ')}`);
  }

  if (!options.url) {
    printUsage();
    process.exit(1);
  }

  const extraction = await extractJobWithPlaywright({
    projectRoot,
    url: options.url,
    config,
    visible: options.visible,
    write: options.write,
  });

  let evaluation = null;
  if (options.score || config.defaults?.score_after_extract === true) {
    evaluation = evaluateJobFit(extraction.job, loadJobFinderConfigs(projectRoot));
  }

  printExtraction(extraction, evaluation, options.json);
}

function parseArgs(argv) {
  const options = {
    check: false,
    url: '',
    visible: false,
    write: false,
    score: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--check') options.check = true;
    else if (arg === '--url') options.url = argv[++index] || '';
    else if (arg === '--visible') options.visible = true;
    else if (arg === '--write') options.write = true;
    else if (arg === '--score') options.score = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--extract') {
      // Default action, kept for script readability.
    } else if (!options.url && /^https?:\/\//i.test(arg)) {
      options.url = arg;
    }
  }

  return options;
}

function printCheck(config, validation) {
  console.log('\nBrowser agent check');
  console.log(JSON.stringify(browserAgentPolicySummary(config), null, 2));
  if (validation.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of validation.warnings) console.log(`- ${warning}`);
  }
  if (validation.errors.length > 0) {
    console.log('\nErrors:');
    for (const error of validation.errors) console.log(`- ${error}`);
  } else {
    console.log('\nOK: safe extraction-only browser agent is configured.');
  }
}

function printExtraction(extraction, evaluation, asJson) {
  if (asJson) {
    console.log(JSON.stringify({ extraction, evaluation }, null, 2));
    return;
  }

  const job = extraction.job;
  console.log('\nBrowser extraction complete');
  console.log(`URL: ${extraction.final_url}`);
  console.log(`HTTP: ${extraction.http_status}`);
  console.log(`Company: ${job.company}`);
  console.log(`Title: ${job.title}`);
  console.log(`Location: ${job.location}`);
  console.log(`Work mode: ${job.work_mode}`);
  console.log(`Description chars: ${String(job.description || '').length}`);
  console.log(`Forms detected: ${extraction.forms.length}`);
  console.log(`Apply links detected: ${extraction.apply_links.length}`);
  if (extraction.warnings.length > 0) {
    console.log(`Warnings: ${extraction.warnings.join('; ')}`);
  }
  if (evaluation) {
    console.log(`Score: ${evaluation.score}/100`);
    console.log(`Recommendation: ${evaluation.recommendation}`);
    console.log(`Red flags: ${evaluation.red_flags.join(', ') || 'none'}`);
  }
  if (extraction.output) {
    console.log(`JSON: ${extraction.output.json}`);
    console.log(`Markdown: ${extraction.output.markdown}`);
  } else {
    console.log('Output: not written. Add --write to save extraction files.');
  }
}

function printUsage() {
  console.log(`
Usage:
  node browser-agent.mjs --check
  node browser-agent.mjs --url "https://example.com/job" --score
  node browser-agent.mjs --url "https://example.com/job" --score --write

Safety:
  - extraction only
  - no form fill
  - no file upload
  - no submit
  - no API keys stored in repo
`);
}

main().catch((error) => {
  console.error(`\nBrowser agent failed: ${error.message}`);
  process.exit(1);
});
