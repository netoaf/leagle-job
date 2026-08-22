#!/usr/bin/env node

/**
 * check-liveness.mjs — Playwright job link liveness checker
 *
 * Tests whether job posting URLs are still active or have expired.
 * Uses the same detection logic as scan.md step 7.5.
 * Zero Claude API tokens — pure Playwright.
 *
 * Usage:
 *   node check-liveness.mjs <url1> [url2] ...
 *   node check-liveness.mjs --file urls.txt
 *
 * Exit code: 0 if all active, 1 if any expired or uncertain
 */

import { chromium } from 'playwright';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  assertSafeNavigationUrl,
  installPlaywrightNetworkGuard,
} from './lib/network/playwright-guard.mjs';

const EXPIRED_PATTERNS = [
  /job (is )?no longer available/i,
  /job.*no longer open/i,           // Greenhouse: "The job you are looking for is no longer open."
  /position has been filled/i,
  /this job has expired/i,
  /job posting has expired/i,
  /no longer accepting applications/i,
  /this (position|role|job) (is )?no longer/i,
  /this job (listing )?is closed/i,
  /job (listing )?not found/i,
  /the page you are looking for doesn.t exist/i, // Workday /job/ 404
  /diese stelle (ist )?(nicht mehr|bereits) besetzt/i,
  /offre (expirée|n'est plus disponible)/i,
  /esta oferta (já|ja) não está acti(?:va|ve)/i,
  /esta oferta (já|ja) não está ativa/i,
  /oferta.*(?:inativa|inactiva|expirada|encerrada)/i,
];

const LISTING_PATTERNS = [
  /\d+\s+jobs?\s+found/i,
  /search for jobs page is loaded/i,
];

// URL patterns that indicate an ATS has redirected away from the job (closed/expired)
const EXPIRED_URL_PATTERNS = [
  /[?&]error=true/i,   // Greenhouse redirect on closed jobs
];

const APPLY_PATTERNS = [
  /\bapply\b/i,          // catches "Apply", "Apply Now", "Apply for this Job"
  /\bsolicitar\b/i,
  /\bbewerben\b/i,
  /\bpostuler\b/i,
  /submit application/i,
  /easy apply/i,
  /start application/i,  // Ashby
  /ich bewerbe mich/i,   // German Greenhouse
  /\bcandidat(?:ar|ura|uras)\b/i,
  /mostrar\s+email/i,    // Net-Empregos official email reveal control
];

// Below this length the page is probably just nav/footer (closed ATS page)
const MIN_CONTENT_CHARS = 300;

export async function checkUrl(page, url, options = {}) {
  try {
    await assertSafeNavigationUrl(url);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const status = response?.status() ?? 0;
    if (status === 404 || status === 410) {
      return { result: 'expired', reason: `HTTP ${status}` };
    }

    // Give SPAs (Ashby, Lever, Workday) time to hydrate
    await page.waitForTimeout(2000);

    // Check if the ATS redirected to an error/listing page (e.g. Greenhouse ?error=true)
    const finalUrl = page.url();
    for (const pattern of EXPIRED_URL_PATTERNS) {
      if (pattern.test(finalUrl)) {
        return { result: 'expired', reason: `redirect to ${finalUrl}` };
      }
    }

    const bodyText = await page.evaluate(() => document.body?.innerText ?? '');

    for (const pattern of EXPIRED_PATTERNS) {
      if (pattern.test(bodyText)) {
        return { result: 'expired', reason: `pattern matched: ${pattern.source}`, final_url: finalUrl, http_status: status };
      }
    }

    if (bodyText.trim().length < MIN_CONTENT_CHARS) {
      return { result: 'expired', reason: 'insufficient content — likely nav/footer only', final_url: finalUrl, http_status: status };
    }

    const titleMatched = roleAppearsOnPage(options.expectedRole, bodyText, await page.title());
    if (!titleMatched) {
      const listingPattern = LISTING_PATTERNS.find((pattern) => pattern.test(bodyText));
      if (listingPattern) {
        return {
          result: 'expired',
          reason: `redirected to a generic listings page: ${listingPattern.source}`,
          final_url: finalUrl,
          http_status: status,
        };
      }
      return {
        result: 'uncertain',
        reason: `expected role not found on rendered page: ${options.expectedRole || 'unknown'}`,
        final_url: finalUrl,
        http_status: status,
      };
    }

    if (hasApplicationChannel(bodyText)) {
      return {
        result: 'active',
        reason: 'role, description and application channel detected',
        final_url: finalUrl,
        http_status: status,
      };
    }

    return {
      result: 'uncertain',
      reason: 'role content present but no application channel found',
      final_url: finalUrl,
      http_status: status,
    };

  } catch (err) {
    return { result: 'expired', reason: `navigation error: ${err.message.split('\n')[0]}` };
  }
}

export async function checkSingleUrl(url, options = {}) {
  const browser = await chromium.launch({ headless: options.visible !== true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await installPlaywrightNetworkGuard(context, {
    blockedResourceTypes: ['image', 'media', 'font'],
  });
  const page = await context.newPage();
  try {
    return await checkUrl(page, url, options);
  } finally {
    await context.close();
    await browser.close();
  }
}

export function roleAppearsOnPage(expectedRole, bodyText, pageTitle = '') {
  const role = normalizeForMatch(expectedRole);
  if (!role) return false;
  const page = normalizeForMatch(`${pageTitle} ${bodyText}`);
  if (!page) return false;
  if (page.includes(role)) return true;

  const ignored = new Set([
    'a', 'at', 'da', 'de', 'do', 'e', 'em', 'for', 'intern', 'internship',
    'junior', 'm', 'f', 'program', 'programme', 'the',
  ]);
  const tokens = role.split(' ').filter((token) => token.length >= 3 && !ignored.has(token));
  if (tokens.length === 0) return false;
  const matched = tokens.filter((token) => page.includes(token)).length;
  return matched >= Math.max(1, Math.ceil(tokens.length * 0.6));
}

export function hasApplicationChannel(bodyText) {
  return APPLY_PATTERNS.some((pattern) => pattern.test(String(bodyText || '')));
}

function normalizeForMatch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: node check-liveness.mjs <url1> [url2] ...');
    console.error('       node check-liveness.mjs --file urls.txt');
    process.exit(1);
  }

  let urls;
  if (args[0] === '--file') {
    const text = await readFile(args[1], 'utf-8');
    urls = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  } else {
    urls = args;
  }

  console.log(`Checking ${urls.length} URL(s)...\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await installPlaywrightNetworkGuard(context, {
    blockedResourceTypes: ['image', 'media', 'font'],
  });
  const page = await context.newPage();

  let active = 0, expired = 0, uncertain = 0;

  // Sequential — project rule: never Playwright in parallel
  for (const url of urls) {
    const { result, reason } = await checkUrl(page, url);
    const icon = { active: '✅', expired: '❌', uncertain: '⚠️' }[result];
    console.log(`${icon} ${result.padEnd(10)} ${url}`);
    if (result !== 'active') console.log(`           ${reason}`);
    if (result === 'active') active++;
    else if (result === 'expired') expired++;
    else uncertain++;
  }

  await context.close();
  await browser.close();

  console.log(`\nResults: ${active} active  ${expired} expired  ${uncertain} uncertain`);
  if (expired > 0 || uncertain > 0) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
