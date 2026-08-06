import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';
import {
  cleanTitle,
  inferLocation,
  inferWorkMode,
  normalizeJob,
  normalizeWhitespace,
  slugify,
  stripHtml,
  todayISO,
} from '../job-normalizer.mjs';
import {
  assertBrowserAgentAction,
  assertSafeUrl,
  browserAgentPolicySummary,
} from './safety.mjs';
import { installPlaywrightNetworkGuard } from '../network/playwright-guard.mjs';

export async function extractJobWithPlaywright({ projectRoot, url, config, visible = false, write = false } = {}) {
  assertBrowserAgentAction(config, 'extract');
  await assertSafeUrl(config, url);

  const extraction = config.extraction || {};
  const timeoutMs = Number(extraction.timeout_ms || 25000);
  const browser = await chromium.launch({ headless: visible ? false : config.defaults?.headless !== false });
  const context = await browser.newContext({
    userAgent: 'LeagleJob BrowserAgent/1.0 (based on Career-Ops; local extraction only; no auto-apply)',
    serviceWorkers: 'block',
  });

  const blockedResourceTypes = new Set(asArray(extraction.block_resource_types));
  await installPlaywrightNetworkGuard(context, { blockedResourceTypes });

  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);

  try {
    const response = await page.goto(url, {
      waitUntil: extraction.wait_until || 'domcontentloaded',
      timeout: timeoutMs,
    });
    await page.waitForTimeout(800);

    const raw = await page.evaluate(({ removeSelectors, maxTextChars }) => {
      const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const textFromHtml = (html) => {
        const node = document.createElement('div');
        node.innerHTML = html || '';
        return clean(node.innerText || node.textContent || '');
      };
      const selectorText = (selector) => clean(document.querySelector(selector)?.innerText || document.querySelector(selector)?.textContent || '');
      const meta = (selector) => clean(document.querySelector(selector)?.getAttribute('content') || '');
      const parseJsonLd = () => {
        const values = [];
        const flatten = (item) => {
          if (!item) return;
          if (Array.isArray(item)) {
            item.forEach(flatten);
            return;
          }
          if (typeof item !== 'object') return;
          values.push(item);
          if (item['@graph']) flatten(item['@graph']);
        };

        for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            flatten(JSON.parse(script.textContent || ''));
          } catch {
            // Ignore invalid JSON-LD blocks.
          }
        }
        return values;
      };
      const typeIncludes = (item, type) => {
        const value = item?.['@type'];
        return Array.isArray(value)
          ? value.some((entry) => clean(entry).toLowerCase() === type)
          : clean(value).toLowerCase() === type;
      };
      const locationText = (location) => {
        const locations = Array.isArray(location) ? location : [location];
        return locations.map((entry) => {
          const address = entry?.address || entry;
          if (!address || typeof address !== 'object') return clean(entry);
          return clean([
            address.addressLocality,
            address.addressRegion,
            address.addressCountry?.name || address.addressCountry,
          ].filter(Boolean).join(', '));
        }).filter(Boolean).join(' / ');
      };

      const jsonLdItems = parseJsonLd();
      const jobPosting = jsonLdItems.find((item) => typeIncludes(item, 'jobposting')) || null;
      const clone = document.body ? document.body.cloneNode(true) : document.createElement('body');
      for (const selector of removeSelectors || []) {
        for (const node of clone.querySelectorAll(selector)) node.remove();
      }

      const bodyText = clean(clone.innerText || clone.textContent || '').slice(0, maxTextChars || 12000);
      const description = jobPosting?.description ? textFromHtml(jobPosting.description) : bodyText;
      const title = clean(jobPosting?.title)
        || selectorText('h1')
        || meta('meta[property="og:title"]')
        || document.title
        || '';
      const company = clean(jobPosting?.hiringOrganization?.name)
        || meta('meta[property="og:site_name"]')
        || '';
      const locationValue = locationText(jobPosting?.jobLocation)
        || selectorText('[data-automation-id*="location"], [class*="location"], [class*="Location"]')
        || '';
      const applyLinks = Array.from(document.querySelectorAll('a[href], button'))
        .map((node) => ({
          text: clean(node.innerText || node.textContent || node.getAttribute('aria-label') || ''),
          href: node.href || '',
          type: node.tagName.toLowerCase(),
        }))
        .filter((item) => /(apply|candidatar|candidatura|submit|candidate|application)/i.test(`${item.text} ${item.href}`))
        .slice(0, 12);

      const forms = Array.from(document.querySelectorAll('form')).map((form) => ({
        action: form.action || '',
        method: form.method || '',
        fields: Array.from(form.querySelectorAll('input, textarea, select')).length,
        submit_buttons: Array.from(form.querySelectorAll('button, input[type="submit"]')).map((button) => clean(button.innerText || button.value || button.getAttribute('aria-label') || '')).filter(Boolean),
      }));

      return {
        page: {
          title: clean(document.title),
          url: window.location.href,
          canonical: document.querySelector('link[rel="canonical"]')?.href || '',
          status_text: '',
        },
        job: {
          title,
          company,
          location: locationValue,
          work_mode: '',
          link: window.location.href,
          description,
          date_posted: clean(jobPosting?.datePosted),
          valid_through: clean(jobPosting?.validThrough),
          employment_type: Array.isArray(jobPosting?.employmentType) ? jobPosting.employmentType.join(', ') : clean(jobPosting?.employmentType),
          compensation: '',
          source: 'browser_agent',
        },
        body_text: bodyText,
        json_ld_job_found: Boolean(jobPosting),
        forms,
        apply_links: applyLinks,
      };
    }, {
      removeSelectors: asArray(extraction.remove_selectors),
      maxTextChars: Number(extraction.max_text_chars || 12000),
    });

    const normalized = normalizeJob({
      ...raw.job,
      title: cleanTitle(raw.job.title || raw.page.title || 'a confirmar'),
      company: raw.job.company || 'a confirmar',
      location: raw.job.location || inferLocation(raw.body_text),
      work_mode: raw.job.work_mode || inferWorkMode(`${raw.job.location} ${raw.body_text}`),
      link: raw.page.canonical || raw.job.link || url,
      description: raw.job.description || raw.body_text,
    });

    const result = {
      extracted_at: new Date().toISOString(),
      requested_url: url,
      final_url: page.url(),
      http_status: response?.status() || 0,
      safety: browserAgentPolicySummary(config),
      json_ld_job_found: raw.json_ld_job_found,
      job: normalized,
      page: {
        ...raw.page,
        status_text: response?.statusText() || '',
      },
      forms: raw.forms || [],
      apply_links: raw.apply_links || [],
      warnings: buildWarnings(raw, normalized),
    };

    if (write) {
      result.output = writeExtraction(projectRoot, config, result);
    }

    return result;
  } finally {
    await context.close();
    await browser.close();
  }
}

export function writeExtraction(projectRoot, config, extraction) {
  const dir = join(projectRoot, config.output_dir || 'output/browser-agent');
  mkdirSync(dir, { recursive: true });
  const label = slugify(`${extraction.job.company || 'company'}-${extraction.job.title || 'job'}`);
  const base = `${todayISO()}-${label}`;
  const jsonPath = join(dir, `${base}.json`);
  const mdPath = join(dir, `${base}.md`);

  writeFileSync(jsonPath, JSON.stringify(extraction, null, 2), 'utf-8');
  writeFileSync(mdPath, renderMarkdown(extraction), 'utf-8');
  return { json: jsonPath, markdown: mdPath };
}

function renderMarkdown(extraction) {
  const job = extraction.job || {};
  return `# Browser Agent Extraction

URL: ${extraction.final_url || extraction.requested_url}
Extracted: ${extraction.extracted_at}
HTTP: ${extraction.http_status || 'a confirmar'}

## Job

- Company: ${job.company || 'a confirmar'}
- Title: ${job.title || 'a confirmar'}
- Location: ${job.location || 'a confirmar'}
- Work mode: ${job.work_mode || 'a confirmar'}
- Employment type: ${job.employment_type || 'a confirmar'}
- Date posted: ${job.date_posted || 'a confirmar'}

## Description

${normalizeWhitespace(stripHtml(job.description || '')).slice(0, 12000) || 'a confirmar'}

## Apply Links

${asArray(extraction.apply_links).map((link) => `- ${link.text || 'link'} ${link.href || ''}`.trim()).join('\n') || '- none detected'}

## Safety

- Never submit: ${extraction.safety?.never_submit === true}
- Human review required: ${extraction.safety?.human_review_required === true}
- Forms detected: ${asArray(extraction.forms).length}
`;
}

function buildWarnings(raw, normalized) {
  const warnings = [];
  if (!raw.json_ld_job_found) warnings.push('No JobPosting JSON-LD found; extraction used visible page text.');
  if (!normalized.title || normalized.title === 'a confirmar') warnings.push('Missing title.');
  if (!normalized.company || normalized.company === 'a confirmar') warnings.push('Missing company.');
  if (!normalized.description || normalized.description.length < 400) warnings.push('Short job description.');
  if (asArray(raw.forms).length > 0) warnings.push('Forms detected but browser agent did not fill or submit anything.');
  return warnings;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}
