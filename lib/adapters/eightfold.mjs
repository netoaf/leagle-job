import { chromium } from 'playwright';
import {
  cleanTitle,
  decodeHtml,
  normalizeWhitespace,
  stripHtml,
} from '../job-normalizer.mjs';
import { installPlaywrightNetworkGuard } from '../network/playwright-guard.mjs';
import { safeFetch } from '../network/safe-fetch.mjs';

const JOB_CARD_SELECTOR = 'a[id^="job-card-"][id$="-job-list"][href*="/careers/job/"]';
const FALLBACK_JOB_SELECTOR = 'a[aria-label^="View job:"][href*="/careers/job/"]';
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_PAGES = 1;
const HARD_MAX_PAGES = 5;
const HARD_MAX_JOBS = 100;
const MAX_DESCRIPTION_CHARS = 30_000;

/**
 * Eightfold protocol and selector behavior are a Leagle Job-native adaptation
 * informed by JobNavigator at commit 387b2c9bd7f1bd627c396c6dddc8d750ce3c4bfb.
 * See THIRD_PARTY_NOTICES.md.
 */
export async function scanEightfoldCompany(company, context = {}, dependencies = {}) {
  const sourceUrl = requireHttpsUrl(company?.careers_url);
  const limit = boundedInteger(context.limit, 1, 1, HARD_MAX_JOBS);
  const maxPages = boundedInteger(company?.scan_pages, DEFAULT_MAX_PAGES, 1, HARD_MAX_PAGES);
  const titleFilter = typeof context.titleFilter === 'function' ? context.titleFilter : () => true;
  const fetcher = dependencies.fetcher || safeFetch;
  const launchBrowser = dependencies.launchBrowser || ((options) => chromium.launch(options));

  const postings = await collectEightfoldPostings({
    sourceUrl: sourceUrl.toString(),
    maxPages,
    limit: HARD_MAX_JOBS,
    launchBrowser,
    timeoutMs: Number(context.timeoutMs || DEFAULT_TIMEOUT_MS),
  });

  const jobs = [];
  let detailAttempts = 0;
  let detailFailures = 0;
  let lastDetailError = null;
  for (const posting of postings) {
    if (jobs.length >= limit) break;
    if (!titleFilter(posting.title)) continue;

    let payload;
    detailAttempts += 1;
    try {
      payload = await fetchEightfoldJobPayload(posting.link, posting.link, { fetcher });
    } catch (error) {
      detailFailures += 1;
      lastDetailError = error;
      continue;
    }
    if (!payload) continue;

    const job = eightfoldJobFromPayload(payload, posting, company.name);
    if (!job.description || job.description.length < 50) continue;
    jobs.push(job);
  }

  if (detailAttempts > 0 && detailFailures === detailAttempts && jobs.length === 0) {
    throw new Error(`Every selected Eightfold detail request failed: ${lastDetailError?.message || 'unknown error'}`);
  }

  return jobs;
}

export async function collectEightfoldPostings({
  sourceUrl,
  maxPages = DEFAULT_MAX_PAGES,
  limit = HARD_MAX_JOBS,
  launchBrowser = (options) => chromium.launch(options),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const parsedSource = requireHttpsUrl(sourceUrl);
  const pageCap = boundedInteger(maxPages, DEFAULT_MAX_PAGES, 1, HARD_MAX_PAGES);
  const jobCap = boundedInteger(limit, HARD_MAX_JOBS, 1, HARD_MAX_JOBS);
  const browser = await launchBrowser({ headless: true });
  const context = await browser.newContext({
    userAgent: 'LeagleJob/1.4 (based on Career-Ops; bounded Eightfold source adapter)',
    locale: 'pt-PT',
    serviceWorkers: 'block',
  });
  await installPlaywrightNetworkGuard(context, {
    blockedResourceTypes: ['image', 'media', 'font'],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);

  try {
    await page.goto(parsedSource.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    await waitForEightfoldCards(page, timeoutMs);

    const results = [];
    const seen = new Set();

    for (let pageNumber = 0; pageNumber < pageCap; pageNumber += 1) {
      const postings = extractEightfoldPostings(await page.content(), page.url());
      for (const posting of postings) {
        if (seen.has(posting.link)) continue;
        seen.add(posting.link);
        results.push(posting);
        if (results.length >= jobCap) return results;
      }

      if (pageNumber >= pageCap - 1) break;
      const changed = await moveToNextEightfoldPage(page, timeoutMs);
      if (!changed) break;
    }

    return results;
  } finally {
    await context.close();
    await browser.close();
  }
}

export function extractEightfoldPostings(html, baseUrl) {
  const source = requireHttpsUrl(baseUrl);
  const preferred = [];
  const fallback = [];
  const anchorPattern = /<a\b([^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(String(html || '')))) {
    const attributes = match[1] || '';
    const href = decodeHtml(match[2] || '');
    const innerHtml = match[3] || '';
    const link = safeSameOriginJobUrl(href, source);
    if (!link) continue;

    const ariaLabel = decodeHtml(attributeValue(attributes, 'aria-label'));
    const title = cleanTitle(
      ariaLabel.replace(/^view job:\s*/i, '')
      || classText(innerHtml, 'title')
      || firstTextLine(innerHtml),
    );
    if (!title || title === 'a confirmar') continue;

    const posting = {
      id: eightfoldJobId(link),
      title,
      location: classText(innerHtml, 'fieldValue') || 'a confirmar',
      posted_text: classText(innerHtml, 'subData'),
      link,
    };
    const id = attributeValue(attributes, 'id');
    if (/^job-card-.*-job-list$/i.test(id)) preferred.push(posting);
    else fallback.push(posting);
  }

  return deduplicatePostings(preferred.length > 0 ? preferred : fallback);
}

export function deriveEightfoldJobApiUrl(jobUrl, sourceUrl) {
  const source = requireHttpsUrl(sourceUrl);
  const job = requireHttpsUrl(jobUrl);
  if (job.origin !== source.origin) {
    throw new Error('Eightfold job URL must use the configured source origin.');
  }

  const id = eightfoldJobId(job.toString());
  if (!id) throw new Error('Eightfold job URL does not contain a valid job identifier.');
  return new URL(`/api/apply/v2/jobs/${encodeURIComponent(id)}`, source.origin).toString();
}

export async function fetchEightfoldJobPayload(jobUrl, sourceUrl, { fetcher = safeFetch } = {}) {
  const source = requireHttpsUrl(sourceUrl);
  const apiUrl = deriveEightfoldJobApiUrl(jobUrl, source.toString());
  const response = await fetcher(apiUrl, {
    timeoutMs: 12_000,
    maxResponseBytes: 2 * 1024 * 1024,
    maxRedirects: 2,
    requireHttps: true,
    allowedHosts: [source.hostname],
    headers: {
      accept: 'application/json',
      'user-agent': 'LeagleJob/1.4 (based on Career-Ops; bounded Eightfold detail fetch)',
    },
  });

  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new Error(`Eightfold detail API returned HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error('Eightfold detail API did not return JSON.');
  }

  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Eightfold detail API returned an invalid payload.');
  }
  return payload;
}

export function eightfoldJobFromPayload(payload, posting, companyName) {
  const title = cleanTitle(payload?.posting_name || payload?.name || posting?.title || '');
  const description = normalizeWhitespace(stripHtml(payload?.job_description || '')).slice(0, MAX_DESCRIPTION_CHARS);
  const location = normalizeEightfoldLocation(payload, posting?.location);

  return {
    title,
    company: normalizeWhitespace(companyName || 'a confirmar'),
    location,
    link: posting?.link || '',
    description,
    employment_type: normalizeWhitespace(payload?.employment_type || ''),
    source: `${normalizeWhitespace(companyName || 'Eightfold')} eightfold`,
  };
}

function normalizeEightfoldLocation(payload, listingLocation) {
  if (listingLocation && listingLocation !== 'a confirmar') return normalizeWhitespace(listingLocation);
  if (typeof payload?.location === 'string' && payload.location.trim()) return normalizeWhitespace(payload.location);

  const locations = Array.isArray(payload?.locations) ? payload.locations : [];
  const values = locations.map((location) => {
    if (typeof location === 'string') return normalizeWhitespace(location);
    if (!location || typeof location !== 'object') return '';
    return normalizeWhitespace(
      location.name
      || location.location
      || [location.city, location.state, location.country].filter(Boolean).join(', '),
    );
  }).filter(Boolean);

  return [...new Set(values)].slice(0, 3).join(' / ') || 'a confirmar';
}

async function waitForEightfoldCards(page, timeoutMs) {
  try {
    await page.waitForSelector(JOB_CARD_SELECTOR, { timeout: Math.min(timeoutMs, 15_000) });
  } catch {
    try {
      await page.waitForSelector(FALLBACK_JOB_SELECTOR, { timeout: 2_000 });
    } catch {
      // A valid source can temporarily have no open jobs.
    }
  }
}

async function moveToNextEightfoldPage(page, timeoutMs) {
  const selector = 'button[aria-label="Next jobs"]';
  const button = page.locator(selector);
  if (await button.count() !== 1) return false;
  if (!await button.isVisible() || await button.isDisabled()) return false;

  const before = await firstEightfoldJobHref(page);
  await button.click({ timeout: Math.min(timeoutMs, 5_000) });
  if (!before) {
    await waitForEightfoldCards(page, timeoutMs);
    return true;
  }

  try {
    await page.waitForFunction(
      ({ cardSelector, fallbackSelector, previous }) => {
        const current = document.querySelector(cardSelector) || document.querySelector(fallbackSelector);
        return Boolean(current?.getAttribute('href') && current.getAttribute('href') !== previous);
      },
      { cardSelector: JOB_CARD_SELECTOR, fallbackSelector: FALLBACK_JOB_SELECTOR, previous: before },
      { timeout: Math.min(timeoutMs, 10_000) },
    );
    return true;
  } catch {
    return false;
  }
}

async function firstEightfoldJobHref(page) {
  const preferred = page.locator(JOB_CARD_SELECTOR);
  if (await preferred.count() > 0) return preferred.first().getAttribute('href');
  const fallback = page.locator(FALLBACK_JOB_SELECTOR);
  if (await fallback.count() > 0) return fallback.first().getAttribute('href');
  return '';
}

function safeSameOriginJobUrl(href, source) {
  let parsed;
  try {
    parsed = new URL(href, source);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'https:' || parsed.origin !== source.origin) return '';
  if (!eightfoldJobId(parsed.toString())) return '';
  parsed.hash = '';
  return parsed.toString();
}

function eightfoldJobId(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  const match = parsed.pathname.match(/\/careers\/job\/([a-z0-9_-]{1,128})\/?$/i);
  return match?.[1] || '';
}

function requireHttpsUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new Error('Eightfold source URL is invalid.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Eightfold source URL must be credential-free HTTPS.');
  }
  return parsed;
}

function attributeValue(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return attributes.match(new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] || '';
}

function classText(html, classFragment) {
  const escaped = classFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(html || '').match(
    new RegExp(`<[^>]+class\\s*=\\s*["'][^"']*${escaped}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i'),
  );
  return normalizeWhitespace(stripHtml(match?.[1] || ''));
}

function firstTextLine(html) {
  return String(stripHtml(html || ''))
    .split(/\r?\n/)
    .map(normalizeWhitespace)
    .find(Boolean) || '';
}

function deduplicatePostings(postings) {
  const seen = new Set();
  return postings.filter((posting) => {
    if (!posting.link || seen.has(posting.link)) return false;
    seen.add(posting.link);
    return true;
  });
}

function boundedInteger(value, fallback, min, max) {
  const number = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}
