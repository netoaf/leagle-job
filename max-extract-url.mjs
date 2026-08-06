#!/usr/bin/env node

import { dirname } from 'path';
import { fileURLToPath } from 'url';
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
  const validation = validateBrowserAgentConfig(browserConfig);
  if (validation.errors.length > 0) {
    throw new Error(`Browser agent config invalid:\n- ${validation.errors.join('\n- ')}`);
  }

  const extraction = await extractJobDescriptionMax({
    projectRoot,
    url: options.url,
    browserConfig,
    visible: options.visible,
    write: options.write,
    useBrowser: options.browser,
    useDirect: options.direct,
  });

  if (options.json) {
    console.log(JSON.stringify(extraction, null, 2));
    return;
  }

  printExtraction(extraction, browserConfig);
}

function parseArgs(argv) {
  const options = {
    url: '',
    visible: false,
    write: false,
    json: false,
    browser: true,
    direct: true,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--url') options.url = argv[++index] || '';
    else if (arg === '--visible') options.visible = true;
    else if (arg === '--write') options.write = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--no-browser') options.browser = false;
    else if (arg === '--no-direct') options.direct = false;
    else if (!options.url && /^https?:\/\//i.test(arg)) options.url = arg;
  }

  return options;
}

function printExtraction(extraction, browserConfig) {
  const job = extraction.job || {};
  console.log('\nMax extraction complete');
  console.log(`URL: ${extraction.final_url || extraction.requested_url}`);
  console.log(`HTTP: ${extraction.http_status || 'a confirmar'}`);
  console.log(`Selected method: ${extraction.selected_text?.method || 'a confirmar'}`);
  console.log(`Description chars: ${extraction.selected_text?.chars || 0}`);
  console.log(`Company: ${job.company || 'a confirmar'}`);
  console.log(`Title: ${job.title || 'a confirmar'}`);
  console.log(`Location: ${job.location || 'a confirmar'}`);
  console.log(`Work mode: ${job.work_mode || 'a confirmar'}`);
  console.log(`Forms detected: ${extraction.forms?.length || 0}`);
  console.log(`Apply links detected: ${extraction.apply_links?.length || 0}`);
  console.log('\nMethods:');
  for (const method of extraction.methods || []) {
    console.log(`- ${method.name}: ${method.ok ? 'ok' : 'failed'}${method.description_chars ? `, ${method.description_chars} chars` : ''}${method.error ? `, ${method.error}` : ''}`);
  }
  if (extraction.output) {
    console.log(`\nJSON: ${extraction.output.json}`);
    console.log(`Markdown: ${extraction.output.markdown}`);
  } else {
    console.log('\nOutput: not written. Add --write to save extraction files.');
  }
  console.log(`Safety: never_submit=${browserAgentPolicySummary(browserConfig).never_submit}, human_review=${browserAgentPolicySummary(browserConfig).human_review_required}`);
}

function printUsage() {
  console.log(`
Usage:
  node max-extract-url.mjs --url "https://example.com/job"
  node max-extract-url.mjs --url "https://example.com/job" --write

Flags:
  --write       Save max extraction under output/max-extract/
  --visible     Open visible browser for debugging
  --no-browser  Use only direct HTTP/HTML extraction
  --no-direct   Use only browser-rendered extraction
  --json        Print full JSON

Safety:
  Extraction only. It never fills forms, uploads CVs or submits applications.
`);
}

main().catch((error) => {
  console.error(`\nMax extraction failed: ${error.message}`);
  process.exit(1);
});
