#!/usr/bin/env node

/**
 * test-all.mjs — Comprehensive test suite for career-ops
 *
 * Run before merging any PR or pushing changes.
 * Tests: syntax, scripts, dashboard, data contract, personal data, paths.
 *
 * Usage:
 *   node test-all.mjs           # Run all tests
 *   node test-all.mjs --quick   # Skip dashboard build (faster)
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const QUICK = process.argv.includes('--quick');

let passed = 0;
let failed = 0;
let warnings = 0;

function pass(msg) { console.log(`  ✅ ${msg}`); passed++; }
function fail(msg) { console.log(`  ❌ ${msg}`); failed++; }
function warn(msg) { console.log(`  ⚠️  ${msg}`); warnings++; }

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', timeout: 30000, ...opts }).trim();
  } catch (e) {
    return null;
  }
}

const gitTopLevel = run('git rev-parse --show-toplevel');
const hasProjectGitMetadata = gitTopLevel !== null
  && resolve(gitTopLevel).toLowerCase() === resolve(ROOT).toLowerCase();

function fileExists(path) { return existsSync(join(ROOT, path)); }
function readFile(path) { return readFileSync(join(ROOT, path), 'utf-8'); }
function textFiles(root = ROOT, relative = '') {
  const files = [];
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
    const next = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (['node_modules', '.git', '.gocache', 'dist', 'tools'].includes(entry.name)) continue;
      files.push(...textFiles(root, next));
    } else {
      files.push(next);
    }
  }
  return files;
}

console.log('\n🧪 Leagle Job test suite\n');

// ── 1. SYNTAX CHECKS ────────────────────────────────────────────

console.log('1. Syntax checks');

const mjsFiles = readdirSync(ROOT).filter(f => f.endsWith('.mjs'));
for (const f of mjsFiles) {
  const result = run(`node --check ${f}`);
  if (result !== null) {
    pass(`${f} syntax OK`);
  } else {
    fail(`${f} has syntax errors`);
  }
}

// ── 2. SCRIPT EXECUTION ─────────────────────────────────────────

console.log('\n2. Script execution (graceful on empty data)');

const scripts = [
  { name: 'cv-sync-check.mjs', expectExit: 1, allowFail: true }, // fails without cv.md (normal in repo)
  { name: 'verify-pipeline.mjs', expectExit: 0 },
  { name: 'normalize-statuses.mjs --dry-run', expectExit: 0 },
  { name: 'dedup-tracker.mjs --dry-run', expectExit: 0 },
  { name: 'merge-tracker.mjs --dry-run', expectExit: 0 },
  { name: 'update-system.mjs check', expectExit: 0 },
];

for (const { name, allowFail } of scripts) {
  const result = run(`node ${name} 2>&1`);
  if (result !== null) {
    pass(`${name} runs OK`);
  } else if (allowFail) {
    warn(`${name} exited with error (expected without user data)`);
  } else {
    fail(`${name} crashed`);
  }
}

// ── 3. DASHBOARD BUILD ──────────────────────────────────────────

const unitTests = run('node --test tests/safe-fetch.test.mjs tests/eightfold-adapter.test.mjs tests/job-pipeline-foundation.test.mjs tests/cv-selector.test.mjs tests/email-drafts-cv-selection.test.mjs tests/job-scoring-service.test.mjs tests/verify-and-draft.test.mjs tests/application-actions.test.mjs tests/source-coverage-audit.test.mjs tests/security-scan-contract.test.mjs tests/localized-mode-contract.test.mjs tests/text-utils.test.mjs');
if (unitTests !== null) {
  pass('Network safety and job-pipeline foundation tests pass');
} else {
  fail('Network safety or job-pipeline foundation tests failed');
}

if (!QUICK) {
  console.log('\n3. Dashboard build');
  const bundledGo = join(ROOT, 'tools', 'go', 'bin', process.platform === 'win32' ? 'go.exe' : 'go');
  const goCommand = existsSync(bundledGo) ? `"${bundledGo}"` : 'go';
  const goEnv = { ...process.env, GOCACHE: join(ROOT, 'dashboard', '.gocache') };
  const goVersion = run(`${goCommand} version`, { env: goEnv });
  if (goVersion === null) {
    warn('Dashboard build skipped (Go is optional and not installed)');
  } else {
    const dashboardOutput = join(tmpdir(), process.platform === 'win32' ? 'career-dashboard-test.exe' : 'career-dashboard-test');
    const goBuild = run(`${goCommand} build -o "${dashboardOutput}" .`, { cwd: join(ROOT, 'dashboard'), env: goEnv });
    if (goBuild !== null) {
      pass('Dashboard compiles');
    } else {
      fail('Dashboard build failed');
    }
  }
} else {
  console.log('\n3. Dashboard build (skipped --quick)');
}

// ── 4. DATA CONTRACT ────────────────────────────────────────────

console.log('\n4. Data contract validation');

// Check system files exist
const systemFiles = [
  'CLAUDE.md', 'VERSION', 'DATA_CONTRACT.md',
  'config/scoring.example.yml', 'config/jobfinder-rules.example.yml',
  'modes/_shared.md', 'modes/_profile.template.md',
  'modes/oferta.md', 'modes/pdf.md', 'modes/scan.md',
  'templates/states.yml', 'templates/cv-template.html',
  'examples/cv-example.md',
  'examples/dual-track-engineer-instructor/cv.md',
  '.claude/skills/career-ops/SKILL.md',
];

for (const f of systemFiles) {
  if (fileExists(f)) {
    pass(`System file exists: ${f}`);
  } else {
    fail(`Missing system file: ${f}`);
  }
}

const ignoredSystemExamples = hasProjectGitMetadata
  ? [
    'examples/cv-example.md',
    'examples/dual-track-engineer-instructor/cv.md',
  ].filter(f => run(`git check-ignore --no-index -- "${f}"`) !== null)
  : [];
if (!hasProjectGitMetadata) {
  pass('Synthetic CV examples present (packaged install; Git tracking check not applicable)');
} else if (ignoredSystemExamples.length === 0) {
  pass('Synthetic CV examples remain trackable');
} else {
  fail(`Synthetic CV examples are ignored (${ignoredSystemExamples.length} file(s))`);
}

// Check the complete private/local User Layer, not only the onboarding files.
// Templates and .gitkeep placeholders remain tracked; real user work must not.
const trackedFiles = hasProjectGitMetadata
  ? (run('git ls-files') || '').split(/\r?\n/).filter(Boolean)
  : [];
const userLayerRules = [
  {
    label: 'CV and portfolio sources',
    matches: f => f === 'cv.md' || /^cv-[^/]+\.md$/i.test(f) || f === 'article-digest.md',
  },
  {
    label: 'candidate configuration',
    matches: f => [
      'config/profile.yml',
      'config/candidate-context.yml',
      'config/email.yml',
      'config/scoring.yml',
      'config/jobfinder-rules.yml',
      'modes/_profile.md',
      'portals.yml',
    ].includes(f) || /^config\/profile-[^/]+\.ya?ml$/i.test(f),
  },
  {
    label: 'runtime data',
    matches: f => f.startsWith('data/') && f !== 'data/.gitkeep',
  },
  {
    label: 'reports and saved job descriptions',
    matches: f => (
      (f.startsWith('reports/') && f !== 'reports/.gitkeep')
      || (f.startsWith('jds/') && f !== 'jds/.gitkeep')
    ),
  },
  {
    label: 'interview preparation',
    matches: f => f.startsWith('interview-prep/') && f !== 'interview-prep/.gitkeep',
  },
  {
    label: 'batch tracker additions',
    matches: f => (
      f.startsWith('batch/tracker-additions/')
      && f !== 'batch/tracker-additions/.gitkeep'
    ),
  },
];

for (const rule of userLayerRules) {
  const matches = trackedFiles.filter(rule.matches);
  if (!hasProjectGitMetadata) {
    pass(`User Layer is local-only in packaged install: ${rule.label}`);
  } else if (matches.length === 0) {
    pass(`User Layer untracked: ${rule.label}`);
  } else {
    fail(`User Layer tracked: ${rule.label} (${matches.length} file(s))`);
  }
}

const privacyIgnoreProbes = [
  '.env',
  '.env.local',
  'credentials.json',
  'private.key',
  'cv.md',
  'cv-private.md',
  'config/profile.yml',
  'config/profile-private.yml',
  'config/candidate-context.yml',
  'config/email.yml',
  'config/scoring.yml',
  'config/jobfinder-rules.yml',
  'modes/_profile.md',
  'portals.yml',
  'data/applications.md',
  'reports/source-health-preview.tsv',
  'output/cv.pdf',
  'jds/job.md',
  'interview-prep/story-bank.md',
  'batch/tracker-additions/merged/001.tsv',
  'backups/private-email-drafts.tsv',
  'docs/GMAIL-DRAFT-AUDIT-2099-01-01.md',
  'docs/superpowers/plans/private-plan.md',
];
const missingIgnoreCoverage = hasProjectGitMetadata
  ? privacyIgnoreProbes.filter(f => run(`git check-ignore --no-index -- "${f}"`) === null)
  : [];
if (!hasProjectGitMetadata && fileExists('.gitignore')) {
  pass(`Privacy ignore policy present in packaged install (${privacyIgnoreProbes.length} documented probes)`);
} else if (missingIgnoreCoverage.length === 0) {
  pass(`Privacy ignore coverage (${privacyIgnoreProbes.length} probes)`);
} else {
  fail(`Privacy ignore gaps (${missingIgnoreCoverage.length} path(s))`);
}

const packageScript = readFile('scripts/create-package.ps1');
const packageOperationalNoteExclusions = [
  '"backups"',
  'docs\\superpowers',
  '^docs\\\\.*-AUDIT-.*\\.md$',
];
const missingPackageOperationalNoteExclusions = packageOperationalNoteExclusions.filter(
  marker => !packageScript.includes(marker),
);
if (missingPackageOperationalNoteExclusions.length === 0) {
  pass('Sanitized package excludes local operational notes');
} else {
  fail(`Sanitized package may include local operational notes (${missingPackageOperationalNoteExclusions.length} exclusion(s) missing)`);
}

const trackedDashboardBinaries = trackedFiles.filter(
  f => /^dashboard\/.*\.exe$/i.test(f)
);
if (!hasProjectGitMetadata) {
  pass('Packaged install has no Git index for the dashboard binary');
} else if (trackedDashboardBinaries.length === 0) {
  pass('Generated dashboard executables are untracked');
} else {
  fail(`Generated dashboard executables are tracked (${trackedDashboardBinaries.length} file(s))`);
}

// A clean current index does not erase private content from older commits.
const historicalUserLayer = hasProjectGitMetadata
  ? run(
    'git log --all --format=%H -- cv.md config/profile.yml config/candidate-context.yml config/scoring.yml config/jobfinder-rules.yml modes/_profile.md portals.yml data reports jds interview-prep batch/tracker-additions'
  )
  : null;
if (!hasProjectGitMetadata) {
  pass('Git history check not applicable to packaged install');
} else if (historicalUserLayer) {
  warn('User Layer exists in Git history; do not publish the repository until history is sanitized');
} else {
  pass('No User Layer paths found in Git history');
}

// ── 5. PERSONAL DATA LEAK CHECK ─────────────────────────────────

console.log('\n5. Personal data leak check');

const leakPatterns = [
  'Santiago', 'santifer.io', 'Santifer iRepair', 'Zinkee', 'ALMAS',
  'hi@santifer.io',
];

const scanExtensions = ['md', 'yml', 'html', 'mjs', 'sh', 'go', 'json'];
const allowedFiles = ['README.md', 'README.es.md', 'LICENSE', 'CITATION.cff', 'CONTRIBUTING.md',
  'package.json', '.github/FUNDING.yml', '.github/ISSUE_TEMPLATE/', 'CLAUDE.md', 'go.mod',
  'dashboard/internal/ui/screens/pipeline.go', 'test-all.mjs'];
const scannedFiles = textFiles().filter(file => scanExtensions.includes(file.split('.').pop().toLowerCase()));

let leakFound = false;
for (const pattern of leakPatterns) {
  for (const file of scannedFiles) {
    if (allowedFiles.some(a => file.includes(a))) continue;
    if (file === 'dashboard/go.sum' || file === 'dashboard/go.mod') continue;
    if (readFile(file).toLowerCase().includes(pattern.toLowerCase())) {
      warn(`Possible personal data in ${file}: "${pattern}"`);
      leakFound = true;
    }
  }
}
if (!leakFound) {
  pass('No personal data leaks outside allowed files');
}

// ── 6. ABSOLUTE PATH CHECK ──────────────────────────────────────

console.log('\n6. Absolute path check');

const absolutePathFiles = scannedFiles.filter(file =>
  !['README.md', 'LICENSE', 'CLAUDE.md', 'test-all.mjs', 'dashboard/go.sum'].some(allowed => file.includes(allowed))
  && readFile(file).includes('/Users/'));
if (absolutePathFiles.length === 0) {
  pass('No absolute paths in code files');
} else {
  for (const file of absolutePathFiles) {
    fail(`Absolute path found in: ${file}`);
  }
}

// ── 7. MODE FILE INTEGRITY ──────────────────────────────────────

console.log('\n7. Mode file integrity');

const expectedModes = [
  '_shared.md', '_profile.template.md', 'oferta.md', 'pdf.md', 'scan.md',
  'batch.md', 'apply.md', 'auto-pipeline.md', 'contacto.md', 'deep.md',
  'ofertas.md', 'pipeline.md', 'project.md', 'tracker.md', 'training.md',
];

for (const mode of expectedModes) {
  if (fileExists(`modes/${mode}`)) {
    pass(`Mode exists: ${mode}`);
  } else {
    fail(`Missing mode: ${mode}`);
  }
}

// Check _shared.md references _profile.md
const shared = readFile('modes/_shared.md');
if (shared.includes('_profile.md')) {
  pass('_shared.md references _profile.md');
} else {
  fail('_shared.md does NOT reference _profile.md');
}

// ── 8. CLAUDE.md INTEGRITY ──────────────────────────────────────

console.log('\n8. CLAUDE.md integrity');

const claude = readFile('CLAUDE.md');
const requiredSections = [
  'Product boundary', 'Data contract', 'Session checks',
  'Canonical operational model', 'External boundaries', 'Verification',
];

for (const section of requiredSections) {
  if (claude.includes(section)) {
    pass(`CLAUDE.md has section: ${section}`);
  } else {
    fail(`CLAUDE.md missing section: ${section}`);
  }
}

// ── 9. VERSION FILE ─────────────────────────────────────────────

console.log('\n9. Version file');

if (fileExists('VERSION')) {
  const version = readFile('VERSION').trim();
  if (/^\d+\.\d+\.\d+$/.test(version)) {
    pass(`VERSION is valid semver: ${version}`);
  } else {
    fail(`VERSION is not valid semver: "${version}"`);
  }
} else {
  fail('VERSION file missing');
}

// ── SUMMARY ─────────────────────────────────────────────────────

console.log('\n' + '='.repeat(50));
console.log(`📊 Results: ${passed} passed, ${failed} failed, ${warnings} warnings`);

if (failed > 0) {
  console.log('🔴 TESTS FAILED — do NOT push/merge until fixed\n');
  process.exit(1);
} else if (warnings > 0) {
  console.log('🟡 Current-worktree tests passed with warnings — review before publishing\n');
  process.exit(0);
} else {
  console.log('🟢 All current-worktree tests passed — review history and staged changes before publishing\n');
  process.exit(0);
}
