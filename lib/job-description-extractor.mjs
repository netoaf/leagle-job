import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { TextDecoder } from 'util';
import { extractJobWithPlaywright } from './browser-agent/playwright-agent.mjs';
import { safeFetch } from './network/safe-fetch.mjs';
import { repairMojibakeText as repairMojibake } from './text-utils.mjs';
import {
  cleanTitle,
  extractYearsExperience,
  inferLocation,
  inferWorkMode,
  normalizeJob,
  normalizeText,
  normalizeWhitespace,
  slugify,
  stripHtml,
  todayISO,
} from './job-normalizer.mjs';

const DEFAULT_TIMEOUT_MS = 25000;
const DEFAULT_MAX_TEXT_CHARS = 30000;

export async function extractJobDescriptionMax({
  projectRoot,
  url,
  browserConfig,
  visible = false,
  write = false,
  useBrowser = true,
  useDirect = true,
} = {}) {
  const methods = [];
  const candidates = [];
  const warnings = [];
  let direct = null;
  let browser = null;

  if (useDirect) {
    try {
      direct = await extractWithDirectFetch(url, browserConfig);
      methods.push(methodSummary('direct_fetch', direct));
      candidates.push(...direct.text_candidates);
    } catch (error) {
      warnings.push(`direct_fetch_failed: ${error.message}`);
      methods.push({ name: 'direct_fetch', ok: false, error: error.message });
    }
  }

  if (useBrowser) {
    try {
      const maxConfig = withMaxBrowserExtraction(browserConfig);
      browser = await extractJobWithPlaywright({
        projectRoot,
        url,
        config: maxConfig,
        visible,
        write: false,
      });
      methods.push({
        name: 'playwright_rendered',
        ok: true,
        http_status: browser.http_status,
        final_url: browser.final_url,
        description_chars: String(browser.job?.description || '').length,
        json_ld_job_found: browser.json_ld_job_found === true,
      });
      candidates.push(textCandidate('playwright_rendered', browser.job?.description, 1.1, {
        title: browser.job?.title,
        company: browser.job?.company,
        location: browser.job?.location,
      }));
    } catch (error) {
      warnings.push(`playwright_rendered_failed: ${error.message}`);
      methods.push({ name: 'playwright_rendered', ok: false, error: error.message });
    }
  }

  const selected = selectBestCandidate(candidates);
  const baseJob = mergeJobs(direct?.job, browser?.job);
  const selectedText = selected?.text || baseJob.description || '';
  const job = normalizeJob({
    ...baseJob,
    title: cleanTitle(baseJob.title || direct?.page?.title || browser?.page?.title || 'a confirmar'),
    company: baseJob.company || 'a confirmar',
    location: baseJob.location || inferLocation(selectedText),
    work_mode: baseJob.work_mode || inferWorkMode(`${baseJob.location || ''} ${selectedText}`),
    link: browser?.page?.canonical || direct?.page?.canonical || browser?.final_url || direct?.final_url || url,
    description: selectedText,
    asks_years_experience: extractYearsExperience(selectedText),
    source: 'max_extractor',
  });

  const result = {
    extracted_at: new Date().toISOString(),
    requested_url: url,
    final_url: browser?.final_url || direct?.final_url || url,
    http_status: browser?.http_status || direct?.http_status || 0,
    safety: browser?.safety || {},
    json_ld_job_found: direct?.json_ld_job_found === true || browser?.json_ld_job_found === true,
    selected_text: selected
      ? {
          method: selected.method,
          chars: selected.text.length,
          useful_score: selected.useful_score,
        }
      : null,
    methods,
    text_candidates: candidates.map((candidate) => ({
      method: candidate.method,
      chars: candidate.text.length,
      useful_score: candidate.useful_score,
      title: candidate.title || '',
      company: candidate.company || '',
      location: candidate.location || '',
    })).sort((a, b) => b.useful_score - a.useful_score),
    job,
    page: {
      title: browser?.page?.title || direct?.page?.title || '',
      url: browser?.page?.url || direct?.page?.url || url,
      canonical: browser?.page?.canonical || direct?.page?.canonical || '',
      status_text: browser?.page?.status_text || direct?.page?.status_text || '',
    },
    forms: browser?.forms || direct?.forms || [],
    apply_links: mergeApplyLinks(browser?.apply_links, direct?.apply_links),
    warnings: cleanWarnings([...warnings, ...asArray(browser?.warnings), ...asArray(direct?.warnings), ...candidateWarnings(selected, candidates)], job),
  };

  if (write) result.output = writeMaxExtraction(projectRoot, result);
  return result;
}

async function extractWithDirectFetch(url, config = {}) {
  const timeoutMs = Number(config?.extraction?.timeout_ms || DEFAULT_TIMEOUT_MS);
  const response = await safeFetch(url, {
    redirect: 'follow',
    timeoutMs,
    maxResponseBytes: 8 * 1024 * 1024,
    headers: {
      'user-agent': 'LeagleJob MaxExtractor/1.0 (based on Career-Ops; local extraction only; no auto-apply)',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || '';
  const html = decodeResponse(arrayBuffer, contentType, response.url || url);
  const portalSpecific = extractPortalSpecificJob(url, html);
  const jsonLd = extractJobPostingJsonLd(html);
  const page = extractPageMeta(html, response.url || url);
  const fullBodyText = cleanJobDescription(stripHtml(html));
  const selectedMainText = bestHtmlRegionText(html);
  const title = cleanTitle(jsonLd?.title || page.ogTitle || page.h1 || page.title || '');
  const company = normalizeWhitespace(jsonLd?.hiringOrganization?.name || page.siteName || companyFromPageTitle(page.title, title) || companyFromHost(response.url || url));
  const location = parseJobPostingLocation(jsonLd?.jobLocation) || inferLocation(`${page.title} ${selectedMainText || fullBodyText}`);
  const description = cleanJobDescription(stripHtml(jsonLd?.description || selectedMainText || fullBodyText));

  return {
    final_url: response.url || url,
    http_status: response.status,
    json_ld_job_found: Boolean(jsonLd || portalSpecific?.json_ld_job_found),
    page,
    job: portalSpecific?.job || normalizeJob({
      title,
      company,
      location,
      work_mode: inferWorkMode(`${location} ${description}`),
      link: page.canonical || response.url || url,
      description,
      date_posted: jsonLd?.datePosted || extractPostedDate(description),
      valid_through: jsonLd?.validThrough || '',
      employment_type: Array.isArray(jsonLd?.employmentType) ? jsonLd.employmentType.join(', ') : jsonLd?.employmentType || '',
      compensation: parseCompensation(jsonLd),
      source: 'max_extractor direct_fetch',
    }),
    text_candidates: [
      textCandidate('portal_specific', portalSpecific?.job?.description, 1.45, portalSpecific?.job || {}),
      textCandidate('direct_json_ld', jsonLd?.description, 1.35, { title, company, location }),
      textCandidate('direct_main_region', selectedMainText, 1.2, { title, company, location }),
      textCandidate('direct_body_text', fullBodyText, 0.85, { title, company, location }),
    ].filter((candidate) => candidate.text),
    forms: extractForms(html, response.url || url),
    apply_links: extractApplyLinks(html, response.url || url),
    warnings: [],
  };
}

function withMaxBrowserExtraction(config = {}) {
  return {
    ...config,
    extraction: {
      ...(config.extraction || {}),
      wait_until: config.extraction?.wait_until || 'networkidle',
      max_text_chars: Math.max(Number(config.extraction?.max_text_chars || 0), DEFAULT_MAX_TEXT_CHARS),
    },
  };
}

function textCandidate(method, value, weight = 1, meta = {}) {
  const text = cleanJobDescription(stripHtml(value || ''));
  return {
    method,
    text,
    useful_score: Math.round(usefulTextScore(text) * weight),
    title: meta.title || '',
    company: meta.company || '',
    location: meta.location || '',
  };
}

function selectBestCandidate(candidates) {
  return candidates
    .filter((candidate) => candidate.text && candidate.text.length >= 80)
    .sort((a, b) => b.useful_score - a.useful_score || b.text.length - a.text.length)[0] || null;
}

function usefulTextScore(text) {
  const normalized = normalizeText(text);
  if (/^(consentir|detalhes|configuracoes dos anuncios|sobre os cookies)/.test(normalized)) return 0;
  if (normalized.includes('nos e os nossos 1022 parceiros') || normalized.includes('fornecedores que fazem parte do iab')) return 0;
  const lengthScore = Math.min(text.length, DEFAULT_MAX_TEXT_CHARS) / 12;
  const usefulSignals = [
    'responsabilidades',
    'requirements',
    'requisitos',
    'perfil',
    'stack',
    'developer',
    'engineer',
    'programador',
    'software',
    'python',
    'javascript',
    'sql',
    'api',
    'estagio',
    'internship',
    'junior',
    'trainee',
    'benefits',
    'oferecemos',
  ].filter((signal) => normalized.includes(normalizeText(signal))).length * 180;
  const noisePenalty = [
    'cookies',
    'configuracoes de cookies',
    'afeganistao albania',
    'anexar cv',
    'enviar candidatura',
    'termos e condicoes',
    'privacy policy',
    'all rights reserved',
  ].filter((signal) => normalized.includes(normalizeText(signal))).length * 3000;

  return Math.max(0, Math.round(lengthScore + usefulSignals - noisePenalty));
}

function cleanJobDescription(value) {
  let text = repairMojibake(normalizeWhitespace(value || ''));
  const cutMarkers = [
    'Ofertas de Emprego Semelhantes',
    'Partilhar Guardar Oferta',
    'Receber Alertas por Email',
    'E-mail Nome Apelidos',
    'Anexar CV',
    'Apply for this job',
    'Enviar candidatura',
    'Os cookies ajudam',
    'Configuracoes de cookies',
  ];

  for (const marker of cutMarkers) {
    const index = normalizeText(text).indexOf(normalizeText(marker));
    if (index > 700) text = text.slice(0, index).trim();
  }

  return text.slice(0, DEFAULT_MAX_TEXT_CHARS);
}

function decodeResponse(arrayBuffer, contentType, url = '') {
  if (/net-empregos\.com/i.test(url)) return new TextDecoder('windows-1252').decode(arrayBuffer);
  const charset = contentType.match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase() || 'utf-8';
  const decoderName = charset.includes('iso-8859') || charset.includes('windows-1252') ? 'windows-1252' : 'utf-8';
  return new TextDecoder(decoderName).decode(arrayBuffer);
}

function extractPortalSpecificJob(url, html) {
  if (/net-empregos\.com/i.test(url)) return extractNetEmpregosJob(url, html);
  return null;
}

function extractNetEmpregosJob(url, html) {
  const jsonLd = extractJobPostingJsonLd(html);
  const fallback = splitTitleCompany(jsonLd?.title || extractPageMeta(html, url).title || '');
  const sourceText = jsonLd?.description || html;
  const fullText = stripHtml(sourceText);
  const description = cleanJobDescription(netEmpregosOfferText(fullText));
  if (!description || description.length < 200) return null;

  const location = parseJobPostingLocation(jsonLd?.jobLocation)
    || netEmpregosHeaderValue(html, /flaticon-pin/)
    || inferLocation(description);
  const title = cleanTitle(fallback.title || jsonLd?.title || '');
  const company = normalizeWhitespace(jsonLd?.hiringOrganization?.name || fallback.company || netEmpregosHeaderValue(html, /flaticon-work/));

  return {
    json_ld_job_found: Boolean(jsonLd),
    job: normalizeJob({
      title,
      company,
      location: normalizeWhitespace(location),
      work_mode: inferWorkMode(`${title} ${location} ${description}`),
      link: url,
      description,
      date_posted: String(jsonLd?.datePosted || extractPostedDate(fullText) || extractPostedDate(description) || '').slice(0, 10),
      valid_through: String(jsonLd?.validThrough || '').slice(0, 10),
      employment_type: Array.isArray(jsonLd?.employmentType) ? jsonLd.employmentType.join(', ') : jsonLd?.employmentType || '',
      compensation: parseCompensation(jsonLd),
      source: 'max_extractor net_empregos',
    }),
  };
}

function splitTitleCompany(value) {
  const cleaned = normalizeWhitespace(stripHtml(value || '')).replace(/\s+-\s+Ref\.\d+.*$/i, '');
  const parts = cleaned.split(/\s+-\s+/);
  if (parts.length >= 2) return { title: parts.slice(0, -1).join(' - '), company: parts.at(-1) };
  return { title: cleaned, company: '' };
}

function netEmpregosHeaderValue(html, iconPattern) {
  const blocks = [...String(html || '').matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
  for (const block of blocks) {
    if (iconPattern.test(block[1])) return normalizeWhitespace(stripHtml(block[1]));
  }
  return '';
}

function netEmpregosOfferText(value) {
  let text = normalizeWhitespace(value || '');
  const marker = normalizeText('Detalhe da Oferta:');
  const normalized = normalizeText(text);
  const index = normalized.indexOf(marker);
  if (index >= 0) text = text.slice(index + 'Detalhe da Oferta:'.length).trim();
  const applyIndex = normalizeText(text).indexOf(normalizeText('Candidate-se atraves do website'));
  if (applyIndex > 800) text = text.slice(0, applyIndex).trim();
  return text;
}

function extractPostedDate(text) {
  const source = normalizeWhitespace(text || '');
  const numeric = source.match(/\b(\d{1,2})-(\d{1,2})-(\d{4})\b/);
  if (numeric) return `${numeric[3]}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`;

  const normalizedSource = normalizeText(source);
  const monthMatch = normalizedSource.match(/\b(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i);
  if (!monthMatch) return '';

  const months = {
    janeiro: '01',
    fevereiro: '02',
    marco: '03',
    abril: '04',
    maio: '05',
    junho: '06',
    julho: '07',
    agosto: '08',
    setembro: '09',
    outubro: '10',
    novembro: '11',
    dezembro: '12',
  };
  return `${new Date().getFullYear()}-${months[normalizeText(monthMatch[2])] || '01'}-${monthMatch[1].padStart(2, '0')}`;
}

function bestHtmlRegionText(html) {
  const candidates = [
    extractTagText(html, 'main'),
    extractTagText(html, 'article'),
    extractByClassName(html, /(job|posting|description|content|offer|vacancy|opportunity)/i),
  ].map((text) => cleanJobDescription(text)).filter(Boolean);

  return selectBestCandidate(candidates.map((text, index) => ({
    method: `html_region_${index}`,
    text,
    useful_score: usefulTextScore(text),
  })))?.text || '';
}

function extractTagText(html, tag) {
  const match = String(html || '').match(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'i'));
  return match ? stripHtml(match[0]) : '';
}

function extractByClassName(html, pattern) {
  const blocks = [...String(html || '').matchAll(/<([a-z0-9]+)\b([^>]*class=["'][^"']+["'][^>]*)>[\s\S]*?<\/\1>/gi)];
  const texts = [];
  for (const block of blocks) {
    if (pattern.test(block[2])) texts.push(stripHtml(block[0]));
  }
  return texts.sort((a, b) => b.length - a.length)[0] || '';
}

function extractJobPostingJsonLd(html) {
  const scripts = [...String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    try {
      const root = JSON.parse(script[1]);
      const item = findJobPosting(root);
      if (item) return item;
    } catch {
      // Ignore invalid JSON-LD.
    }
  }
  return null;
}

function findJobPosting(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  const type = value['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((entry) => normalizeText(entry) === 'jobposting')) return value;
  return findJobPosting(value['@graph']);
}

function extractPageMeta(html, url) {
  return {
    title: normalizeWhitespace(stripHtml(String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')),
    h1: normalizeWhitespace(stripHtml(String(html || '').match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '')),
    ogTitle: extractMeta(html, 'property', 'og:title'),
    siteName: extractMeta(html, 'property', 'og:site_name'),
    canonical: String(html || '').match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] || '',
    url,
    status_text: '',
  };
}

function companyFromPageTitle(pageTitle, jobTitle) {
  const parts = normalizeWhitespace(pageTitle || '').split(/\s+(?:\||\u2013|-)\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return '';
  const jobKey = normalizeText(jobTitle || '');
  const candidate = parts.find((part) => normalizeText(part) && !jobKey.includes(normalizeText(part)));
  return candidate || '';
}

function companyFromHost(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const ignored = new Set(['com', 'pt', 'io', 'jobs', 'careers', 'opportunities', 'job-boards', 'boards', 'net-empregos']);
    const part = host.split('.').find((piece) => piece && !ignored.has(piece.toLowerCase()));
    return part ? part.charAt(0).toUpperCase() + part.slice(1) : '';
  } catch {
    return '';
  }
}

function extractMeta(html, attr, name) {
  const pattern = new RegExp(`<meta[^>]+${attr}=["']${escapeRegExp(name)}["'][^>]+content=["']([^"']+)["']`, 'i');
  return normalizeWhitespace(stripHtml(String(html || '').match(pattern)?.[1] || ''));
}

function parseJobPostingLocation(location) {
  const locations = Array.isArray(location) ? location : [location];
  return locations.map((entry) => {
    const address = entry?.address || entry;
    if (!address || typeof address !== 'object') return normalizeWhitespace(entry || '');
    return normalizeWhitespace([
      address.addressLocality,
      address.addressRegion,
      address.addressCountry?.name || address.addressCountry,
    ].filter(Boolean).join(', '));
  }).filter(Boolean).join(' / ');
}

function parseCompensation(jobPosting) {
  const base = jobPosting?.baseSalary;
  if (!base) return '';
  if (typeof base === 'string') return base;
  const value = base.value || {};
  return normalizeWhitespace([
    value.minValue && value.maxValue ? `${value.minValue}-${value.maxValue}` : value.value,
    value.unitText || base.currency,
  ].filter(Boolean).join(' '));
}

function extractForms(html, baseUrl) {
  return [...String(html || '').matchAll(/<form\b([^>]*)>[\s\S]*?<\/form>/gi)].slice(0, 10).map((match) => ({
    action: absolutize(match[1].match(/action=["']([^"']+)["']/i)?.[1] || '', baseUrl),
    method: match[1].match(/method=["']([^"']+)["']/i)?.[1] || '',
    fields: (match[0].match(/<(input|textarea|select)\b/gi) || []).length,
    submit_buttons: [...match[0].matchAll(/<(button|input)[^>]*(?:type=["']submit["'])?[^>]*>([\s\S]*?)<\/button>/gi)].map((button) => normalizeWhitespace(stripHtml(button[2]))).filter(Boolean),
  }));
}

function extractApplyLinks(html, baseUrl) {
  return [...String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({
      text: normalizeWhitespace(stripHtml(match[2])),
      href: absolutize(match[1], baseUrl),
      type: 'a',
    }))
    .filter((link) => !/(twitter\.com|facebook\.com|linkedin\.com\/share|mailto:)/i.test(link.href || ''))
    .filter((link) => /(apply|candidatar|candidatura|candidate|application|jobs)/i.test(`${link.text} ${link.href}`))
    .slice(0, 20);
}

function mergeJobs(...jobs) {
  const result = {};
  for (const job of jobs.filter(Boolean)) {
    for (const [key, value] of Object.entries(job)) {
      if (isUseful(value) && !isUseful(result[key])) result[key] = value;
    }
  }
  return result;
}

function mergeApplyLinks(...lists) {
  const seen = new Set();
  const result = [];
  for (const link of lists.flatMap((list) => asArray(list))) {
    const key = `${link.text || ''}|${link.href || ''}`;
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    result.push(link);
  }
  return result.slice(0, 20);
}

function candidateWarnings(selected, candidates) {
  const warnings = [];
  if (!selected) warnings.push('No usable text candidate selected.');
  if (selected && selected.text.length < 800) warnings.push('Selected description is still short.');
  if (candidates.length > 1) {
    const sorted = [...candidates].sort((a, b) => b.text.length - a.text.length);
    if (sorted[0]?.text.length > (selected?.text.length || 0) * 2) {
      warnings.push('Longer text existed but was rejected as lower-quality/noisier.');
    }
  }
  return warnings;
}

function cleanWarnings(warnings, job) {
  const companyKnown = isUseful(job.company);
  const titleKnown = isUseful(job.title);
  const descriptionKnown = String(job.description || '').length >= 400;
  return [...new Set(warnings.filter((warning) => {
    if (warning === 'Missing company.' && companyKnown) return false;
    if (warning === 'Missing title.' && titleKnown) return false;
    if (warning === 'Short job description.' && descriptionKnown) return false;
    return true;
  }))];
}

function methodSummary(name, extraction) {
  return {
    name,
    ok: true,
    http_status: extraction.http_status,
    final_url: extraction.final_url,
    description_chars: String(extraction.job?.description || '').length,
    json_ld_job_found: extraction.json_ld_job_found === true,
  };
}

export function writeMaxExtraction(projectRoot, extraction) {
  const dir = join(projectRoot, 'output', 'max-extract');
  mkdirSync(dir, { recursive: true });
  const label = slugify(`${extraction.job?.company || 'company'}-${extraction.job?.title || 'job'}`);
  const base = `${todayISO()}-${label}`;
  const jsonPath = join(dir, `${base}.json`);
  const mdPath = join(dir, `${base}.md`);

  writeFileSync(jsonPath, JSON.stringify(extraction, null, 2), 'utf-8');
  writeFileSync(mdPath, renderMaxMarkdown(extraction), 'utf-8');
  return { json: jsonPath, markdown: mdPath };
}

function renderMaxMarkdown(extraction) {
  const job = extraction.job || {};
  return `# Max Job Extraction

URL: ${extraction.final_url || extraction.requested_url}
Extracted: ${extraction.extracted_at}
Selected method: ${extraction.selected_text?.method || 'a confirmar'}
Description chars: ${extraction.selected_text?.chars || 0}

## Job

- Company: ${job.company || 'a confirmar'}
- Title: ${job.title || 'a confirmar'}
- Location: ${job.location || 'a confirmar'}
- Work mode: ${job.work_mode || 'a confirmar'}
- Date posted: ${job.date_posted || 'a confirmar'}
- Employment type: ${job.employment_type || 'a confirmar'}

## Methods

${extraction.methods.map((method) => `- ${method.name}: ${method.ok ? 'ok' : 'failed'}${method.description_chars ? `, ${method.description_chars} chars` : ''}${method.error ? `, ${method.error}` : ''}`).join('\n') || '- a confirmar'}

## Description

${job.description || 'a confirmar'}

## Warnings

${extraction.warnings.map((warning) => `- ${warning}`).join('\n') || '- none'}
`;
}

function isUseful(value) {
  if (Array.isArray(value)) return value.length > 0;
  const text = normalizeWhitespace(value || '');
  return Boolean(text && normalizeText(text) !== 'a confirmar');
}

function absolutize(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href || '';
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
