#!/usr/bin/env node

/**
 * doctor.mjs — Setup validation for career-ops
 * Checks all prerequisites and prints a pass/fail checklist.
 */

import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadJobFinderConfigs, loadYamlFile } from './lib/config-loader.mjs';
import { validateJobFinderConfig } from './job-scoring-service.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;

// ANSI colors (only on TTY)
const isTTY = process.stdout.isTTY;
const green = (s) => isTTY ? `\x1b[32m${s}\x1b[0m` : s;
const red = (s) => isTTY ? `\x1b[31m${s}\x1b[0m` : s;
const dim = (s) => isTTY ? `\x1b[2m${s}\x1b[0m` : s;

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0]);
  if (major >= 18) {
    return { pass: true, label: `Node.js >= 18 (v${process.versions.node})` };
  }
  return {
    pass: false,
    label: `Node.js >= 18 (found v${process.versions.node})`,
    fix: 'Install Node.js 18 or later from https://nodejs.org',
  };
}

function checkDependencies() {
  if (existsSync(join(projectRoot, 'node_modules'))) {
    return { pass: true, label: 'Dependencies installed' };
  }
  return {
    pass: false,
    label: 'Dependencies not installed',
    fix: 'Run setup.bat on Windows, or: npm ci',
  };
}

async function checkPlaywright() {
  try {
    const { chromium } = await import('playwright');
    const execPath = chromium.executablePath();
    if (existsSync(execPath) || playwrightHeadlessShellExists(execPath)) {
      return { pass: true, label: 'Playwright chromium installed' };
    }
    if (existsSync(join(projectRoot, 'node_modules', 'playwright'))) {
      return { pass: true, label: 'Playwright installed (browser path not readable in current sandbox)' };
    }
    return {
      pass: false,
      label: 'Playwright chromium not installed',
      fix: 'Run: npx playwright install chromium',
    };
  } catch {
    return {
      pass: false,
      label: 'Playwright chromium not installed',
      fix: 'Run: npx playwright install chromium',
    };
  }
}

function playwrightHeadlessShellExists(execPath) {
  const headlessPath = execPath
    .replace(/\\chromium-\d+\\chrome-win64\\chrome\.exe$/i, (match) =>
      match.replace(/chromium-(\d+)\\chrome-win64\\chrome\.exe/i, 'chromium_headless_shell-$1\\chrome-headless-shell-win64\\chrome-headless-shell.exe'))
    .replace(/\/chromium-\d+\/chrome-linux\/chrome$/i, (match) =>
      match.replace(/chromium-(\d+)\/chrome-linux\/chrome/i, 'chromium_headless_shell-$1/chrome-linux/headless_shell'))
    .replace(/\/chromium-\d+\/chrome-mac\/Chromium\.app\/Contents\/MacOS\/Chromium$/i, (match) =>
      match.replace(/chromium-(\d+)\/chrome-mac\/Chromium\.app\/Contents\/MacOS\/Chromium/i, 'chromium_headless_shell-$1/chrome-mac/headless_shell'));
  return headlessPath !== execPath && existsSync(headlessPath);
}

function checkCv() {
  if (existsSync(join(projectRoot, 'cv.md'))) {
    return { pass: true, label: 'cv.md found' };
  }
  return {
    pass: false,
    label: 'cv.md not found',
    fix: [
      'Create cv.md in the project root with your CV in markdown',
      'See examples/ for reference CVs',
    ],
  };
}

function checkProfile() {
  if (existsSync(join(projectRoot, 'config', 'profile.yml'))) {
    return { pass: true, label: 'config/profile.yml found' };
  }
  return {
    pass: false,
    label: 'config/profile.yml not found',
    fix: [
      'Run: cp config/profile.example.yml config/profile.yml',
      'Then edit it with your details',
    ],
  };
}

function checkStructuredConfig() {
  const scoringPath = join(projectRoot, 'config', 'scoring.yml');
  const rulesPath = join(projectRoot, 'config', 'jobfinder-rules.yml');
  if (!existsSync(scoringPath) || !existsSync(rulesPath)) {
    return {
      pass: false,
      label: 'structured scoring/rules config missing',
      fix: [
        'Copy config/scoring.example.yml to config/scoring.yml',
        'Copy config/jobfinder-rules.example.yml to config/jobfinder-rules.yml',
      ],
    };
  }

  try {
    const result = validateJobFinderConfig(loadJobFinderConfigs(projectRoot));
    if (result.errors.length === 0) {
      return { pass: true, label: 'structured scoring/rules config valid' };
    }
    return {
      pass: false,
      label: 'structured scoring/rules config invalid',
      fix: result.errors,
    };
  } catch (error) {
    return {
      pass: false,
      label: 'structured scoring/rules config unreadable',
      fix: error.message,
    };
  }
}

function checkQualityGateConfig() {
  const file = join(projectRoot, 'config', 'quality-gate.yml');
  if (!existsSync(file)) {
    return {
      pass: false,
      label: 'quality gate config missing',
      fix: 'Create config/quality-gate.yml',
    };
  }

  try {
    const config = loadYamlFile(file);
    const errors = [];
    if (!Array.isArray(config.required) || config.required.length === 0) errors.push('required cannot be empty.');
    if (!Array.isArray(config.reject_if) || config.reject_if.length === 0) errors.push('reject_if cannot be empty.');
    const rankMinimum = Number(config.minimums?.quality_score_to_rank);
    if (!Number.isFinite(rankMinimum) || rankMinimum < 0 || rankMinimum > 100) {
      errors.push('minimums.quality_score_to_rank must be between 0 and 100.');
    }
    if (errors.length === 0) return { pass: true, label: 'quality gate config valid' };
    return { pass: false, label: 'quality gate config invalid', fix: errors };
  } catch (error) {
    return {
      pass: false,
      label: 'quality gate config unreadable',
      fix: error.message,
    };
  }
}

function checkPortals() {
  if (existsSync(join(projectRoot, 'portals.yml'))) {
    return { pass: true, label: 'portals.yml found' };
  }
  return {
    pass: false,
    label: 'portals.yml not found',
    fix: [
      'Run: cp templates/portals.example.yml portals.yml',
      'Then customize with your target companies',
    ],
  };
}

function checkFonts() {
  const fontsDir = join(projectRoot, 'fonts');
  if (!existsSync(fontsDir)) {
    return {
      pass: false,
      label: 'fonts/ directory not found',
      fix: 'The fonts/ directory is required for PDF generation',
    };
  }
  try {
    const files = readdirSync(fontsDir);
    if (files.length === 0) {
      return {
        pass: false,
        label: 'fonts/ directory is empty',
        fix: 'The fonts/ directory must contain font files for PDF generation',
      };
    }
  } catch {
    return {
      pass: false,
      label: 'fonts/ directory not readable',
      fix: 'Check permissions on the fonts/ directory',
    };
  }
  return { pass: true, label: 'Fonts directory ready' };
}

function checkAutoDir(name) {
  const dirPath = join(projectRoot, name);
  if (existsSync(dirPath)) {
    return { pass: true, label: `${name}/ directory ready` };
  }
  try {
    mkdirSync(dirPath, { recursive: true });
    return { pass: true, label: `${name}/ directory ready (auto-created)` };
  } catch {
    return {
      pass: false,
      label: `${name}/ directory could not be created`,
      fix: `Run: mkdir ${name}`,
    };
  }
}

async function main() {
  console.log('\nLeagle Job doctor');
  console.log('================\n');

  const checks = [
    checkNodeVersion(),
    checkDependencies(),
    await checkPlaywright(),
    checkCv(),
    checkProfile(),
    checkStructuredConfig(),
    checkQualityGateConfig(),
    checkPortals(),
    checkFonts(),
    checkAutoDir('data'),
    checkAutoDir('output'),
    checkAutoDir('reports'),
  ];

  let failures = 0;

  for (const result of checks) {
    if (result.pass) {
      console.log(`${green('✓')} ${result.label}`);
    } else {
      failures++;
      console.log(`${red('✗')} ${result.label}`);
      const fixes = Array.isArray(result.fix) ? result.fix : [result.fix];
      for (const hint of fixes) {
        console.log(`  ${dim('→ ' + hint)}`);
      }
    }
  }

  console.log('');
  if (failures > 0) {
    console.log(`Result: ${failures} issue${failures === 1 ? '' : 's'} found. Fix them and run \`npm run doctor\` again.`);
    process.exit(1);
  } else {
    console.log('Result: All checks passed. You\'re ready to use Leagle Job with Codex, Claude Code, or another compatible agent.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('doctor.mjs failed:', err.message);
  process.exit(1);
});
