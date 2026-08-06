#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadYamlFile } from './lib/config-loader.mjs';
import {
  addJobToLookup,
  createEmptyJobLookup,
  findJobInLookup,
  loadKnownJobLookup,
} from './lib/job-index.mjs';
import { extractJobWithPlaywright } from './lib/browser-agent/playwright-agent.mjs';
import {
  loadBrowserAgentConfig,
  validateBrowserAgentConfig,
} from './lib/browser-agent/safety.mjs';
import { scanEightfoldCompany } from './lib/adapters/eightfold.mjs';
import {
  assertSafeNavigationUrl,
  installPlaywrightNetworkGuard,
} from './lib/network/playwright-guard.mjs';
import { safeFetch } from './lib/network/safe-fetch.mjs';
import {
  cleanTitle,
  extractAnchors,
  isExpiredText,
  normalizeJob,
  normalizeText,
  normalizeWhitespace,
  stripHtml,
  todayISO,
} from './lib/job-normalizer.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const USER_AGENT = 'LeagleJob/1.4 (based on Career-Ops; local candidate tool; respectful low-volume scan)';
const PORTUGAL_PRIORITY_COMPANIES = new Set([
  'outsystems',
  'feedzai',
  'talkdesk',
  'blip',
  'critical techworks',
  'unbabel',
  'sword health',
  'mindera',
  'xpand it',
  'imaginary cloud',
  'defined.ai',
  'untile',
  'rows',
  'noesis',
  'devoteam',
  'ntt data portugal',
  'farfetch',
  'accenture portugal',
  'capgemini portugal',
  'inetum portugal',
  'aubay portugal',
  'sap',
  'bosch portugal',
  'siemens portugal',
  'zalando',
  'n26',
  'critical software',
  'critical manufacturing',
  'mercedes-benz.io',
  'mercedes benz.io',
  'volkswagen digital solutions',
  'vwds',
  'sky portugal',
  'natixis portugal',
  'bnp paribas portugal',
  'euronext',
  'sibs',
  'celfocus',
  'novabase',
  'axians portugal',
  'primeit',
  'kwan',
  'askblue',
  'match profiler',
  'bee engineering',
  'minsait portugal',
  'claranet portugal',
  'kyndryl portugal',
  't-systems portugal',
  'itsector',
  'glintt',
  'pixelmatters',
  'altar.io',
  'subvisual',
  'significa',
  'whitesmith',
  'ubiwhere',
  'jscrambler',
  'infraspeak',
  'tonic app',
  'xgeeks',
  'bytepitch',
  'olx group',
  'dellent',
  'integer consulting',
  'kcs it',
  'teya portugal',
  'revolut',
  'bolt',
  'coverflex',
  'rauva',
  'pleez',
  'sensei',
  'attentive.ai',
  'indie campers',
  'hiscox portugal',
  'wellhub',
  'valtech portugal',
  'metyis',
  'ci&t portugal',
  'cognizant portugal',
  'epam portugal',
  'bjss portugal',
  'softinsa',
  'quidgest',
  'phc software',
  'cegid portugal',
  'vortal',
  'tekever',
  'ceiia',
  'synopsys portugal',
  'thales portugal',
  'vodafone portugal',
  'altice portugal',
  'nokia portugal',
  'ericsson portugal',
  'cisco portugal',
  'microsoft portugal',
  'aws portugal',
  'cloudflare',
  'checkout.com',
  'mollie',
  'paddle',
]);
const DEFAULT_SCAN_PROFILES = {
  default_profile: 'pt',
  profiles: {
    pt: {
      per_company_quota: 4,
      job_boards: [
        { source: 'ITJobs.pt', quota: 14 },
        { source: 'Landing.jobs', quota: 8 },
      ],
      company_groups: [
        { group: 'portugal_priority', quota: 18 },
        { group: 'portugal_general', quota: 8 },
      ],
    },
    remote: {
      per_company_quota: 5,
      job_boards: [
        { source: 'Landing.jobs', quota: 10 },
      ],
      company_groups: [
        { group: 'remote_europe', quota: 30 },
        { group: 'global', quota: 10 },
      ],
    },
    global: {
      per_company_quota: 4,
      job_boards: [
        { source: 'ITJobs.pt', quota: 10 },
        { source: 'Landing.jobs', quota: 10 },
      ],
      company_groups: [
        { group: 'portugal_priority', quota: 15 },
        { group: 'portugal_general', quota: 10 },
        { group: 'remote_europe', quota: 15 },
        { group: 'global', quota: 20 },
      ],
    },
  },
};

export async function runScan(options = {}) {
  const root = options.projectRoot || projectRoot;
  const portals = loadYamlFile(join(root, 'portals.yml'));
  const scanProfiles = loadScanProfiles(root);
  const scanProfileName = resolveScanProfileName(options.profile, scanProfiles);
  const scanProfile = scanProfiles.profiles?.[scanProfileName] || DEFAULT_SCAN_PROFILES.profiles.pt;
  const positiveKeywords = asArray(portals.title_filter?.positive);
  const negativeKeywords = asArray(portals.title_filter?.negative);
  const scanMode = options.refreshKnown ? 'refresh-known' : options.includeSeen ? 'audit' : 'new-only';
  const knownJobs = options.includeSeen ? createEmptyJobLookup() : loadKnownJobLookup(root);
  const runJobs = createEmptyJobLookup();
  const candidates = [];
  const skipped = [];
  const errors = [];
  const sourceStats = [];
  const limit = Number(options.limit || 30);
  const sourceMode = Boolean(options.source);

  if (options.jobBoards !== false && shouldScanJobBoards(options.source)) {
    const jobBoardPlan = sourceMode
      ? allJobBoardSources().filter(([name]) => shouldScanJobBoardSource(options.source, name)).map(([source]) => ({ source, quota: limit }))
      : asArray(scanProfile.job_boards);
    await scanJobBoards(jobBoardPlan, {
      positiveKeywords,
      negativeKeywords,
      candidates,
      skipped,
      errors,
      sourceStats,
      knownJobs,
      runJobs,
      includeSeen: options.includeSeen,
      limit,
      projectRoot: root,
    });
  }

  const companies = asArray(portals.tracked_companies)
    .filter((company) => company && company.enabled !== false && company.careers_url)
    .filter((company) => !options.source || normalizeText(company.name).includes(normalizeText(options.source)))
    .sort((a, b) => companyPriority(b) - companyPriority(a) || String(a.name).localeCompare(String(b.name)));

  if (sourceMode) {
    await scanCompanies(companies, {
      positiveKeywords,
      negativeKeywords,
      candidates,
      skipped,
      errors,
      sourceStats,
      knownJobs,
      runJobs,
      includeSeen: options.includeSeen,
      limit,
      projectRoot: root,
    });
  } else {
    const visitedCompanies = new Set();
    for (const groupPlan of asArray(scanProfile.company_groups)) {
      if (candidates.length >= limit) break;
      const groupCompanies = companies
        .filter((company) => companyGroupFor(company) === groupPlan.group)
        .filter((company) => !visitedCompanies.has(company.name));
      for (const company of groupCompanies) visitedCompanies.add(company.name);
      await scanCompanies(groupCompanies, {
        positiveKeywords,
        negativeKeywords,
        candidates,
        skipped,
        errors,
        sourceStats,
        knownJobs,
        runJobs,
        includeSeen: options.includeSeen,
        limit,
        projectRoot: root,
        quota: Number(groupPlan.quota || limit),
        perCompanyQuota: Number(groupPlan.per_company_quota || scanProfile.per_company_quota || limit),
      });
    }
  }

  const result = {
    scanned_at: new Date().toISOString(),
    profile: sourceMode ? `source:${options.source}` : scanProfileName,
    scan_mode: scanMode,
    known_index_size: knownJobs.count,
    total_candidates: candidates.length,
    candidates,
    skipped,
    errors,
    source_stats: sourceStats,
  };

  if (options.writeSnapshot) {
    result.snapshot_path = writeScanSnapshot(root, result, options.dryRun);
  }

  if (options.updateHistory && candidates.length > 0) {
    appendScanHistory(root, candidates, 'scanned');
  }

  return result;
}

function shouldScanJobBoards(source) {
  if (!source) return true;
  const text = normalizeText(source);
  return ['itjobs', 'landing', 'remotive', 'yc jobs', 'ycombinator', 'we work remotely', 'weworkremotely', 'wwr'].some((name) => name.includes(text) || text.includes(name));
}

function loadScanProfiles(root) {
  const file = join(root, 'config', 'scan-profiles.yml');
  if (!existsSync(file)) return DEFAULT_SCAN_PROFILES;
  return loadYamlFile(file);
}

function resolveScanProfileName(requested, scanProfiles) {
  const defaultProfile = scanProfiles.default_profile || DEFAULT_SCAN_PROFILES.default_profile;
  const profileName = requested || defaultProfile;
  if (!scanProfiles.profiles?.[profileName]) {
    throw new Error(`Unknown scan profile "${profileName}". Available profiles: ${Object.keys(scanProfiles.profiles || {}).join(', ')}`);
  }
  return profileName;
}

async function scanJobBoards(jobBoardPlan, context) {
  const sources = new Map(allJobBoardSources().map(([name, url, scanner]) => [normalizeText(name), { name, url, scanner }]));

  for (const plan of asArray(jobBoardPlan)) {
    if (context.candidates.length >= context.limit) break;
    const source = sources.get(normalizeText(plan.source || ''));
    if (!source) {
      context.errors.push({ company: plan.source || 'unknown job board', url: '', error: 'unknown_job_board_source' });
      context.sourceStats.push({
        source: plan.source || 'unknown job board',
        type: 'job_board',
        discovered: 0,
        accepted: 0,
        skipped: 0,
        error: 'unknown_job_board_source',
      });
      continue;
    }

    try {
      const remaining = Math.min(Number(plan.quota || context.limit), context.limit - context.candidates.length);
      if (remaining <= 0) continue;
      const acceptedBefore = context.candidates.length;
      const skippedBefore = context.skipped.length;
      const boardJobs = await source.scanner({
        positiveKeywords: context.positiveKeywords,
        negativeKeywords: context.negativeKeywords,
        limit: remaining,
      });
      addDiscoveredJobs(boardJobs, context);
      context.sourceStats.push({
        source: source.name,
        type: 'job_board',
        discovered: boardJobs.length,
        accepted: context.candidates.length - acceptedBefore,
        skipped: context.skipped.length - skippedBefore,
        error: '',
      });
    } catch (error) {
      context.errors.push({ company: source.name, url: source.url, error: error.message });
      context.sourceStats.push({
        source: source.name,
        type: 'job_board',
        discovered: 0,
        accepted: 0,
        skipped: 0,
        error: error.message,
      });
    }
  }
}

async function scanCompanies(companies, context) {
  const quota = Number(context.quota || context.limit);
  const perCompanyQuota = Number(context.perCompanyQuota || context.limit);
  let acceptedBefore = context.candidates.length;

  for (const company of companies) {
    if (context.candidates.length >= context.limit) break;
    if ((context.candidates.length - acceptedBefore) >= quota) break;

    try {
      const remainingForGroup = quota - (context.candidates.length - acceptedBefore);
      const acceptedBeforeCompany = context.candidates.length;
      const skippedBeforeCompany = context.skipped.length;
      const discovered = await scanCompany(company, {
        positiveKeywords: context.positiveKeywords,
        negativeKeywords: context.negativeKeywords,
        limit: Math.min(context.limit - context.candidates.length, remainingForGroup, perCompanyQuota),
        projectRoot: context.projectRoot || projectRoot,
      });

      addDiscoveredJobs(discovered, { ...context, companyName: company.name });
      context.sourceStats.push({
        source: company.name,
        type: companyGroupFor(company),
        discovered: discovered.length,
        accepted: context.candidates.length - acceptedBeforeCompany,
        skipped: context.skipped.length - skippedBeforeCompany,
        error: '',
      });
    } catch (error) {
      context.errors.push({ company: company.name, url: company.careers_url, error: error.message });
      context.sourceStats.push({
        source: company.name,
        type: companyGroupFor(company),
        discovered: 0,
        accepted: 0,
        skipped: 0,
        error: error.message,
      });
    }
  }
}

function allJobBoardSources() {
  return [
    ['ITJobs.pt', 'https://www.itjobs.pt/ofertas', scanItJobs],
    ['Landing.jobs', 'https://landing.jobs/jobs', scanLandingJobsBoard],
    ['Remotive', 'https://remotive.com/api/remote-jobs', scanRemotiveBoard],
    ['YC Jobs', 'https://www.ycombinator.com/jobs', scanYcJobsBoard],
    ['We Work Remotely', 'https://www.weworkremotely.com/remote-jobs/search', scanWeWorkRemotelyBoard],
  ];
}

function shouldScanJobBoardSource(source, name) {
  if (!source) return true;
  const text = normalizeText(source);
  const normalizedName = normalizeText(name);
  return normalizedName.includes(text) || text.includes(normalizedName.split('.')[0]);
}

async function scanItJobs(context) {
  const queries = [
    'junior',
    'estagio',
    'estagiario',
    'internship',
    'trainee',
    'developer junior',
    'software engineer internship',
  ];
  const urls = new Set();
  const jobs = [];

  for (const query of queries) {
    if (jobs.length >= context.limit) break;
    const url = `https://www.itjobs.pt/ofertas?q=${encodeURIComponent(query)}`;
    const listing = await fetchText(url, 15000);
    const offerUrls = extractItJobsOfferUrls(listing.text);

    for (const offerUrl of offerUrls) {
      if (jobs.length >= context.limit) break;
      if (urls.has(offerUrl)) continue;
      urls.add(offerUrl);

      const titleFromSlug = titleFromItJobsUrl(offerUrl);
      if (!matchesTitleFilter(titleFromSlug, context.positiveKeywords, context.negativeKeywords)) continue;

      const detail = await safeFetchJobDetail(offerUrl);
      const parsed = detail?.text ? extractJobPostingFromHtml(detail.text) : null;
      const title = cleanTitle(parsed?.title || titleFromSlug);
      if (!matchesTitleFilter(title, context.positiveKeywords, context.negativeKeywords)) continue;

      const description = stripHtml(parsed?.description || detail?.text || '');
      if (isExpiredText(description, offerUrl)) continue;

      jobs.push({
        title,
        company: parsed?.company || 'a confirmar',
        location: parsed?.location || inferLocationFromUrlAndText(offerUrl, description),
        link: offerUrl,
        description,
        source: 'ITJobs.pt',
        is_active: parsed?.validThrough ? !isPastDate(parsed.validThrough) : true,
      });
    }
  }

  return jobs;
}

async function scanLandingJobsBoard(context) {
  const queries = [
    'junior',
    'internship',
    'trainee',
    'frontend',
    'backend',
    'full stack',
    'python',
  ];
  const urls = new Set();
  const jobs = [];

  for (const query of queries) {
    if (jobs.length >= context.limit) break;
    const listing = await fetchText(`https://landing.jobs/jobs?query=${encodeURIComponent(query)}`, 15000);
    const offerUrls = extractLandingJobsUrls(listing.text, listing.finalUrl || 'https://landing.jobs/jobs');

    for (const offerUrl of offerUrls) {
      if (jobs.length >= context.limit) break;
      if (urls.has(offerUrl)) continue;
      urls.add(offerUrl);

      const detail = await safeFetchJobDetail(offerUrl);
      const parsed = detail?.text ? extractJobPostingFromHtml(detail.text) : null;
      const title = cleanTitle(parsed?.title || titleFromUrlSlug(offerUrl));
      if (!matchesTitleFilter(title, context.positiveKeywords, context.negativeKeywords)) continue;

      const description = stripHtml(parsed?.description || detail?.text || title);
      if (isExpiredText(description, offerUrl)) continue;

      jobs.push({
        title,
        company: parsed?.company || extractLandingCompany(detail?.text || '') || 'a confirmar',
        location: parsed?.location || inferLocationFromUrlAndText(offerUrl, description),
        link: offerUrl,
        description,
        source: 'Landing.jobs',
      });
    }
  }

  return jobs;
}

async function scanRemotiveBoard(context) {
  const queries = [
    'junior developer',
    'software developer intern',
    'backend intern',
    'full stack intern',
    'frontend junior',
    'python junior',
  ];
  const urls = new Set();
  const jobs = [];

  for (const query of queries) {
    if (jobs.length >= context.limit) break;
    const response = await fetchText(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}`, 20000);
    const data = JSON.parse(response.text);

    for (const item of asArray(data.jobs)) {
      if (jobs.length >= context.limit) break;
      const link = item.url || '';
      if (!link || urls.has(link)) continue;
      urls.add(link);

      const title = cleanTitle(item.title || '');
      if (!matchesTitleFilter(title, context.positiveKeywords, context.negativeKeywords)) continue;

      const description = stripHtml([
        item.description,
        item.category,
        item.job_type,
        item.candidate_required_location,
        asArray(item.tags).join(', '),
      ].filter(Boolean).join('\n'));
      if (isExpiredText(description, link)) continue;

      jobs.push({
        title,
        company: item.company_name || 'a confirmar',
        location: item.candidate_required_location || 'Remote',
        work_mode: 'Remote',
        link,
        description,
        source: 'Remotive',
      });
    }
  }

  return jobs;
}

async function scanYcJobsBoard(context) {
  const queries = [
    'junior developer',
    'software engineer intern',
    'backend intern',
    'full stack intern',
    'frontend engineer',
    'python developer',
  ];
  const urls = new Set();
  const jobs = [];

  for (const query of queries) {
    if (jobs.length >= context.limit) break;
    const page = await fetchText(`https://www.ycombinator.com/jobs?query=${encodeURIComponent(query)}`, 20000);
    const anchors = extractAnchors(page.text, page.finalUrl || 'https://www.ycombinator.com/jobs');

    for (const anchor of anchors) {
      if (jobs.length >= context.limit) break;
      if (!isYcJobUrl(anchor.href) || urls.has(anchor.href)) continue;
      urls.add(anchor.href);

      const slugData = parseWeWorkRemotelySlug(anchor.href);
      const title = cleanTitle(slugData.title || anchor.text || titleFromUrlSlug(anchor.href));
      if (!matchesTitleFilter(title, context.positiveKeywords, context.negativeKeywords)) continue;

      const detail = await safeFetchJobDetail(anchor.href);
      const parsed = detail?.text ? extractJobPostingFromHtml(detail.text) : null;
      const description = normalizeWhitespace(stripHtml(parsed?.description || detail?.text || `${title} YC startup remote`)).slice(0, 6000);
      if (isExpiredText(description, anchor.href)) continue;

      jobs.push({
        title: parsed?.title ? cleanTitle(parsed.title) : title,
        company: parsed?.company || companyFromYcUrl(anchor.href) || 'YC startup',
        location: parsed?.location || inferLocationFromUrlAndText(anchor.href, description),
        work_mode: inferWorkModeFromText(description),
        link: anchor.href,
        description,
        source: 'YC Jobs',
      });
    }
  }

  return jobs;
}

async function scanWeWorkRemotelyBoard(context) {
  const queries = [
    'junior developer',
    'software developer intern',
    'backend intern',
    'full stack intern',
    'frontend junior',
    'python junior',
  ];
  const urls = new Set();
  const jobs = [];

  for (const query of queries) {
    if (jobs.length >= context.limit) break;
    const page = await fetchRenderedPage(`https://www.weworkremotely.com/remote-jobs/search?term=${encodeURIComponent(query)}`, 30000);
    const anchors = extractAnchors(page.text, page.finalUrl || 'https://www.weworkremotely.com/remote-jobs/search');

    for (const anchor of anchors) {
      if (jobs.length >= context.limit) break;
      if (!isWeWorkRemotelyJobUrl(anchor.href) || urls.has(anchor.href)) continue;
      urls.add(anchor.href);

      const slugData = parseWeWorkRemotelySlug(anchor.href);
      const title = cleanTitle(slugData.title || anchor.text || titleFromUrlSlug(anchor.href));
      if (!matchesTitleFilter(title, context.positiveKeywords, context.negativeKeywords)) continue;

      const detail = await safeFetchJobDetail(anchor.href);
      const parsed = detail?.text ? extractJobPostingFromHtml(detail.text) : null;
      const description = normalizeWhitespace(stripHtml(parsed?.description || detail?.text || `${title} remote`)).slice(0, 6000);
      if (isExpiredText(description, anchor.href)) continue;

      jobs.push({
        title: parsed?.title ? cleanTitle(parsed.title) : title,
        company: parsed?.company || slugData.company || companyFromWeWorkRemotelyText(anchor.text) || 'a confirmar',
        location: parsed?.location || inferLocationFromUrlAndText(anchor.href, description) || 'Remote',
        work_mode: 'Remote',
        link: anchor.href,
        description,
        source: 'We Work Remotely',
      });
    }
  }

  return jobs;
}

async function scanCompany(company, context) {
  if (isConfiguredAdapter(company, 'browser_agent')) return scanBrowserAgentCompany(company, context);
  if (isConfiguredAdapter(company, 'eightfold')) {
    return scanEightfoldCompany(company, {
      ...context,
      titleFilter: (title) => matchesTitleFilter(title, context.positiveKeywords, context.negativeKeywords),
    });
  }
  if (isConfiguredAdapter(company, 'teamtailor')) return scanTeamtailorCompany(company, context);
  if (isWorkdayApiUrl(company.api) || isWorkdayUrl(company.careers_url)) return scanWorkdayCompany(company, context);
  if (isNoesisCompany(company)) return scanNoesisCompany(company, context);
  if (isLandingJobsUrl(company.careers_url)) return scanLandingJobsCompany(company, context);
  if (company.api || isGreenhouseUrl(company.careers_url)) return scanGreenhouseCompany(company, context);
  if (isAshbyUrl(company.careers_url)) return scanAshbyCompany(company, context);
  if (isLeverUrl(company.careers_url)) return scanLeverCompany(company, context);
  if (isSmartRecruitersUrl(company.careers_url)) return scanSmartRecruitersCompany(company, context);
  if (isWorkableUrl(company.careers_url) || isConfiguredAdapter(company, 'workable')) return scanWorkableCompany(company, context);
  return scanHtmlCompany(company, context);
}

async function scanBrowserAgentCompany(company, context) {
  const root = context.projectRoot || projectRoot;
  const config = loadBrowserAgentConfig(root);
  if (config.scanner?.enabled === false) {
    throw new Error('browser_agent scanner integration is disabled in config/browser-agent.yml.');
  }

  const validation = validateBrowserAgentConfig(config);
  if (validation.errors.length > 0) {
    throw new Error(`browser_agent config invalid: ${validation.errors.join('; ')}`);
  }

  const extraction = await extractJobWithPlaywright({
    projectRoot: root,
    url: company.careers_url,
    config,
    visible: false,
    write: false,
  });

  const extracted = extraction.job || {};
  const title = cleanTitle(extracted.title || '');
  if (!title || title === 'a confirmar') return [];
  if (!matchesTitleFilter(title, context.positiveKeywords, context.negativeKeywords)) return [];

  const description = normalizeWhitespace(stripHtml(extracted.description || ''));
  const link = extracted.link || extraction.final_url || company.careers_url;
  if (isExpiredText(description, link)) return [];

  return [{
    ...extracted,
    title,
    company: extracted.company && extracted.company !== 'a confirmar' ? extracted.company : company.name,
    location: extracted.location || inferLocationFromUrlAndText(link, description),
    work_mode: extracted.work_mode || inferWorkModeFromText(`${extracted.location || ''} ${description}`),
    link,
    description: description || normalizeWhitespace(`${title} ${company.notes || ''}`),
    source: `${company.name} browser_agent`,
  }];
}

async function scanGreenhouseCompany(company, context) {
  const apiUrl = withGreenhouseContent(company.api || deriveGreenhouseApiUrl(company.careers_url));
  if (!apiUrl) return scanHtmlCompany(company, context);

  const response = await fetchText(apiUrl);
  const data = JSON.parse(response.text);
  const jobs = asArray(data.jobs);
  const results = [];

  for (const item of jobs) {
    if (results.length >= context.limit) break;
    const title = cleanTitle(item.title || '');
    if (!matchesTitleFilter(title, context.positiveKeywords, context.negativeKeywords)) continue;

    const description = stripHtml(item.content || '');
    const link = item.absolute_url || item.url || '';
    if (isExpiredText(description, link)) continue;

    results.push({
      title,
      company: company.name,
      location: item.location?.name || 'a confirmar',
      link,
      description,
      source: `${company.name} greenhouse_api`,
    });
  }

  return results;
}

async function scanAshbyCompany(company, context) {
  const page = await fetchText(company.careers_url);
  const appData = extractAshbyAppData(page.text);
  const postings = findAshbyPostings(appData);
  if (postings.length === 0) {
    const renderedPage = await fetchRenderedPage(company.careers_url);
    return scanHtmlContentCompany(company, context, renderedPage);
  }

  const slug = ashbySlug(company.careers_url);
  const results = [];

  for (const posting of postings) {
    if (results.length >= context.limit) break;
    if (posting.isListed === false) continue;

    const title = cleanTitle(posting.title || '');
    if (!matchesTitleFilter(title, context.positiveKeywords, context.negativeKeywords)) continue;

    const link = postingLinkFromAshby(slug, posting);
    const detail = link ? await safeFetchJobDetail(link) : null;
    const detailData = detail?.text ? extractAshbyAppData(detail.text) : null;
    const detailPosting = detailData?.posting || posting;
    const description = ashbyDescription(detailPosting, posting);

    if (isExpiredText(description, link)) continue;

    results.push({
      title,
      company: company.name,
      location: ashbyLocation(detailPosting),
      work_mode: detailPosting.workplaceType || posting.workplaceType || 'a confirmar',
      link,
      description,
      source: `${company.name} ashby`,
    });
  }

  return results;
}

async function scanLeverCompany(company, context) {
  const page = await fetchText(company.careers_url);
  const postings = extractLeverPostings(page.text, company.careers_url);
  const results = [];

  for (const posting of postings) {
    if (results.length >= context.limit) break;
    const title = cleanTitle(posting.title || '');
    if (!matchesTitleFilter(title, context.positiveKeywords, context.negativeKeywords)) continue;

    const detail = await safeFetchJobDetail(posting.link);
    const parsed = detail?.text ? extractJobPostingFromHtml(detail.text) : null;
    const description = stripHtml(parsed?.description || detail?.text || posting.description || '');

    if (isExpiredText(description, posting.link)) continue;

    results.push({
      title,
      company: company.name,
      location: posting.location || parsed?.location || 'a confirmar',
      work_mode: posting.work_mode || 'a confirmar',
      link: posting.link,
      description,
      source: `${company.name} lever`,
    });
  }

  return results;
}

async function scanLandingJobsCompany(company, context) {
  const page = await fetchText(company.careers_url);
  const offerUrls = extractLandingJobsUrls(page.text, page.finalUrl || company.careers_url);
  const results = [];
  const seen = new Set();

  for (const offerUrl of offerUrls) {
    if (results.length >= context.limit) break;
    if (seen.has(offerUrl)) continue;
    seen.add(offerUrl);

    const detail = await safeFetchJobDetail(offerUrl);
    const parsed = detail?.text ? extractJobPostingFromHtml(detail.text) : null;
    const title = cleanTitle(parsed?.title || titleFromUrlSlug(offerUrl));
    if (!matchesTitleFilter(title, context.positiveKeywords, context.negativeKeywords)) continue;

    const description = stripHtml(parsed?.description || detail?.text || title);
    if (isExpiredText(description, offerUrl)) continue;

    results.push({
      title,
      company: parsed?.company || company.name,
      location: parsed?.location || inferLocationFromUrlAndText(offerUrl, description),
      link: offerUrl,
      description,
      source: `${company.name} landing_jobs`,
    });
  }

  return results;
}

async function scanWorkdayCompany(company, context) {
  const apiUrl = company.api || deriveWorkdayApiUrl(company.careers_url);
  if (!apiUrl) return scanHtmlCompany(company, context);

  let response;
  try {
    response = await fetchJson(apiUrl, {
      appliedFacets: {},
      limit: context.limit,
      offset: 0,
      searchText: '',
    });
  } catch (error) {
    const message = normalizeText(error.message);
    if (message.includes('http 422') || message.includes('http 500')) return [];
    throw error;
  }
  const data = JSON.parse(response.text);
  const postings = asArray(data.jobPostings);
  const results = [];

  for (const posting of postings) {
    if (results.length >= context.limit) break;
    const title = cleanTitle(posting.title || '');
    if (!matchesTitleFilter(title, context.positiveKeywords, context.negativeKeywords)) continue;

    const link = workdayPostingLink(apiUrl, posting.externalPath);
    const description = normalizeWhitespace([
      title,
      posting.locationsText,
      posting.timeType,
      posting.jobFamilyGroup,
      ...asArray(posting.bulletFields),
    ].filter(Boolean).join(' '));

    if (isExpiredText(description, link)) continue;

    results.push({
      title,
      company: company.name,
      location: posting.locationsText || inferLocationFromUrlAndText(link, description),
      work_mode: inferWorkModeFromText(description),
      link,
      description,
      source: `${company.name} workday_api`,
    });
  }

  return results;
}

async function scanSmartRecruitersCompany(company, context) {
  const apiUrl = company.api || deriveSmartRecruitersApiUrl(company.careers_url);
  if (!apiUrl) return scanHtmlCompany(company, context);

  const response = await fetchText(apiUrl);
  const data = JSON.parse(response.text);
  const postings = asArray(data.content);
  const results = [];

  for (const posting of postings) {
    if (results.length >= context.limit) break;
    const title = cleanTitle(posting.name || '');
    if (!matchesTitleFilter(title, context.positiveKeywords, context.negativeKeywords)) continue;

    const location = smartRecruitersLocation(posting);
    if (isPortugalScopedCompany(company) && !isPortugalLocation(location, posting)) continue;

    const link = posting.releasedUrl || smartRecruitersPostingLink(company.careers_url, posting.id);
    const description = normalizeWhitespace([
      title,
      location,
      posting.industry?.label,
      posting.function?.label,
      posting.typeOfEmployment?.label,
      posting.experienceLevel?.label,
    ].filter(Boolean).join(' '));

    if (isExpiredText(description, link)) continue;

    results.push({
      title,
      company: company.name,
      location: location || 'a confirmar',
      work_mode: inferWorkModeFromText(description),
      link,
      description,
      source: `${company.name} smartrecruiters_api`,
    });
  }

  return results;
}

async function scanWorkableCompany(company, context) {
  const page = await fetchText(company.careers_url);
  const jobsMarkdownUrl = deriveWorkableJobsMarkdownUrl(company.careers_url, page.text)
    || await discoverWorkableJobsMarkdownUrl(company.careers_url);
  if (!jobsMarkdownUrl) return scanHtmlContentCompany(company, context, page);

  const markdown = await fetchText(jobsMarkdownUrl);
  const postings = extractWorkableMarkdownPostings(markdown.text);
  const results = [];

  for (const posting of postings) {
    if (results.length >= context.limit) break;
    const title = cleanTitle(posting.title || '');
    if (!matchesTitleFilter(title, context.positiveKeywords, context.negativeKeywords)) continue;
    if (isPortugalScopedCompany(company) && !isPortugalLocation(posting.location)) continue;

    const detail = posting.detail ? await safeFetchJobDetail(posting.detail) : null;
    const description = markdownToText(detail?.text || [
      title,
      posting.department,
      posting.location,
      posting.type,
    ].filter(Boolean).join(' '));

    if (isExpiredText(description, posting.detail)) continue;

    results.push({
      title,
      company: company.name,
      location: posting.location || inferLocationFromUrlAndText(posting.detail, description),
      work_mode: inferWorkModeFromText(`${posting.location} ${description}`),
      link: workablePublicJobUrl(posting.detail || jobsMarkdownUrl),
      description,
      compensation: normalizeWhitespace(posting.salary || ''),
      date_posted: posting.posted || '',
      employment_type: posting.type || '',
      source: `${company.name} workable`,
    });
  }

  return results;
}

async function scanTeamtailorCompany(company, context) {
  const page = await fetchText(company.careers_url);
  const postings = extractTeamtailorPostings(page.text, page.finalUrl || company.careers_url);
  const results = [];

  for (const posting of postings) {
    if (results.length >= context.limit) break;
    const title = cleanTitle(posting.title || titleFromUrlSlug(posting.link));
    if (!matchesTitleFilter(title, context.positiveKeywords, context.negativeKeywords)) continue;

    const detail = await safeFetchJobDetail(posting.link);
    const parsed = detail?.text ? extractJobPostingFromHtml(detail.text) : null;
    const description = stripHtml(parsed?.description || detail?.text || posting.description || title);

    if (isExpiredText(description, posting.link)) continue;

    results.push({
      title: parsed?.title ? cleanTitle(parsed.title) : title,
      company: company.name,
      location: parsed?.location || posting.location || inferLocationFromUrlAndText(posting.link, description),
      work_mode: posting.work_mode || 'a confirmar',
      link: posting.link,
      description,
      source: `${company.name} teamtailor`,
    });
  }

  return results;
}

async function scanNoesisCompany(company, context) {
  const page = await fetchText(company.careers_url);
  const postings = extractNoesisPostings(page.text, page.finalUrl || company.careers_url);
  const results = [];

  for (const posting of postings) {
    if (results.length >= context.limit) break;
    const title = cleanTitle(posting.title || '');
    if (!matchesTitleFilter(title, context.positiveKeywords, context.negativeKeywords)) continue;

    const detail = await safeFetchJobDetail(posting.link);
    const parsed = detail?.text ? extractJobPostingFromHtml(detail.text) : null;
    const description = stripHtml(parsed?.description || detail?.text || posting.description || '');

    if (isExpiredText(description, posting.link)) continue;

    results.push({
      title,
      company: company.name,
      location: posting.location || parsed?.location || inferLocationFromUrlAndText(posting.link, description),
      work_mode: posting.work_mode || 'a confirmar',
      link: posting.link,
      description,
      source: `${company.name} noesis`,
    });
  }

  return results;
}

async function scanHtmlCompany(company, context) {
  const pagesToScan = Number(company.scan_pages || 1);
  const results = [];

  for (let pageNumber = 1; pageNumber <= pagesToScan; pageNumber++) {
    if (results.length >= context.limit) break;
    const pageUrl = pageNumber === 1 ? company.careers_url : withPageParam(company.careers_url, pageNumber);
    const page = await fetchCompanyPage({ ...company, careers_url: pageUrl });
    const pageResults = await scanHtmlContentCompany(company, {
      ...context,
      limit: context.limit - results.length,
    }, page);
    results.push(...pageResults);
  }

  return results;
}

async function fetchCompanyPage(company) {
  if (shouldUseBrowserFallback(company)) return fetchRenderedPage(company.careers_url);

  try {
    const page = await fetchText(company.careers_url);
    return page;
  } catch (error) {
    throw error;
  }
}

async function scanHtmlContentCompany(company, context, page) {
  const anchors = extractAnchors(page.text, page.finalUrl || company.careers_url);
  const results = [];
  const seen = new Set();

  for (const anchor of anchors) {
    if (results.length >= context.limit) break;
    if (!isLikelyJobAnchor(anchor)) continue;

    const title = cleanTitle(anchor.text);
    if (!matchesTitleFilter(title, context.positiveKeywords, context.negativeKeywords)) continue;
    if (seen.has(anchor.href)) continue;

    const detail = await safeFetchJobDetail(anchor.href);
    const description = detail?.text
      ? normalizeWhitespace(stripHtml(detail.text)).slice(0, 6000)
      : normalizeWhitespace(`${title} ${company.notes || ''}`);

    if (isExpiredText(description, anchor.href)) {
      seen.add(anchor.href);
      continue;
    }

    results.push({
      title,
      company: company.name,
      location: inferLocationFromUrlAndText(anchor.href, description),
      link: anchor.href,
      description,
      source: `${company.name} careers_page`,
    });
    seen.add(anchor.href);
  }

  return results;
}

async function fetchRenderedPage(url, timeoutMs = 25000) {
  await assertSafeNavigationUrl(url);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'pt-PT',
    serviceWorkers: 'block',
  });
  await installPlaywrightNetworkGuard(context, {
    blockedResourceTypes: ['image', 'media', 'font'],
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(2500);
    return {
      finalUrl: page.url(),
      contentType: 'text/html; rendered=playwright',
      text: await page.content(),
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function safeFetchJobDetail(url) {
  try {
    return await fetchText(url, 12000);
  } catch {
    return null;
  }
}

async function fetchText(url, timeoutMs = 15000) {
  const response = await safeFetch(url, {
    timeoutMs,
    maxResponseBytes: 8 * 1024 * 1024,
    headers: {
      'accept': 'text/html,application/json;q=0.9,*/*;q=0.8',
      'accept-language': 'pt-PT,pt;q=0.9,en;q=0.8',
      'user-agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return {
    finalUrl: response.url,
    contentType: response.headers.get('content-type') || '',
    text: await response.text(),
  };
}

async function fetchJson(url, body, timeoutMs = 15000) {
  const response = await safeFetch(url, {
    method: 'POST',
    timeoutMs,
    maxRequestBytes: 1024 * 1024,
    maxResponseBytes: 8 * 1024 * 1024,
    headers: {
      'accept': 'application/json,*/*;q=0.8',
      'accept-language': 'pt-PT,pt;q=0.9,en;q=0.8',
      'content-type': 'application/json',
      'user-agent': USER_AGENT,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return {
    finalUrl: response.url,
    contentType: response.headers.get('content-type') || '',
    text: await response.text(),
  };
}

function matchesTitleFilter(title, positiveKeywords, negativeKeywords) {
  const text = normalizeText(title);
  const hasPositive = positiveKeywords.length === 0 || positiveKeywords.some((keyword) => keywordMatches(text, keyword));
  const hasNegative = negativeKeywords.some((keyword) => keywordMatches(text, keyword));
  return hasPositive && !hasNegative;
}

function keywordMatches(normalizedText, keyword) {
  const normalizedKeyword = normalizeText(keyword).replace(/\s+/g, ' ').trim();
  if (!normalizedKeyword) return false;
  if (normalizedKeyword.includes(' ')) return normalizedText.includes(normalizedKeyword);

  const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#.]|$)`, 'i').test(normalizedText);
}

function isLikelyJobAnchor(anchor) {
  const text = normalizeText(anchor.text);
  const url = normalizeText(anchor.href);
  if (anchor.text.length < 4 || anchor.text.length > 180) return false;
  if (hasAny(text, ['privacy', 'cookies', 'terms', 'login', 'sign in', 'home', 'blog', 'contact', 'talent community'])) return false;
  return hasAny(url, [
    '/job',
    '/jobs',
    '/careers',
    '/oferta',
    '/positions',
    '/opening',
    'greenhouse',
    'ashbyhq',
    'lever.co',
    'workable.com',
    'workdayjobs',
    'smartrecruiters',
  ]);
}

function inferLocationFromUrlAndText(url, text) {
  const source = normalizeText(`${url} ${text}`);
  const locations = [
    ['lisboa', 'Lisboa'],
    ['lisbon', 'Lisboa'],
    ['porto', 'Porto'],
    ['coimbra', 'Coimbra'],
    ['aveiro', 'Aveiro'],
    ['braga', 'Braga'],
    ['portugal', 'Portugal'],
    ['remote', 'Remote'],
    ['remoto', 'Remote'],
  ];
  const found = locations.filter(([needle]) => source.includes(needle)).map(([, label]) => label);
  return [...new Set(found)].slice(0, 3).join(' / ') || 'a confirmar';
}

function inferWorkModeFromText(value) {
  const text = normalizeText(value);
  if (hasAny(text, ['remote', 'remoto', 'fully remote'])) return 'Remote';
  if (hasAny(text, ['hybrid', 'hibrido', 'part remote'])) return 'Hybrid';
  if (hasAny(text, ['onsite', 'on-site', 'presencial'])) return 'Onsite';
  return 'a confirmar';
}

function addDiscoveredJobs(discovered, context) {
  for (const raw of discovered) {
    const job = normalizeJob(raw);
    if (!job.link) {
      context.skipped.push({ company: context.companyName || job.company, title: job.title, reason: 'missing_link' });
      continue;
    }
    if (!job.is_active) {
      context.skipped.push({ company: context.companyName || job.company, title: job.title, link: job.link, reason: 'inactive_or_expired' });
      continue;
    }
    if (!context.includeSeen) {
      const knownMatch = findJobInLookup(context.knownJobs, job, { companyRole: true });
      if (knownMatch) {
        context.skipped.push({
          company: context.companyName || job.company,
          title: job.title,
          link: job.link,
          reason: `known_${knownMatch.type}`,
        });
        continue;
      }
    }

    const runMatch = findJobInLookup(context.runJobs, job, { companyRole: false });
    if (runMatch) {
      context.skipped.push({
        company: context.companyName || job.company,
        title: job.title,
        link: job.link,
        reason: `duplicate_${runMatch.type}`,
      });
      continue;
    }

    context.candidates.push(job);
    addJobToLookup(context.runJobs, job, { status: 'candidate' });
    if (context.candidates.length >= context.limit) break;
  }
}

function extractItJobsOfferUrls(html) {
  const urls = new Set();
  const matches = html.matchAll(/href=["'](\/oferta\/\d+\/[^"']+)["']/gi);
  for (const match of matches) urls.add(new URL(match[1], 'https://www.itjobs.pt').toString());
  return [...urls];
}

function titleFromItJobsUrl(url) {
  const slug = url.split('/').filter(Boolean).pop() || '';
  return cleanTitle(slug.split('-').map(capitalize).join(' '));
}

function extractJobPostingFromHtml(html) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script[1].trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const job = items.find((item) => item && item['@type'] === 'JobPosting');
      if (!job) continue;
      return {
        title: job.title,
        description: job.description,
        company: job.hiringOrganization?.name,
        location: parseJobPostingLocation(job.jobLocation),
        validThrough: job.validThrough,
        datePosted: job.datePosted,
        employmentType: Array.isArray(job.employmentType) ? job.employmentType.join(', ') : job.employmentType,
      };
    } catch {
      // Keep scanning; some pages include malformed JSON-LD.
    }
  }
  return null;
}

function parseJobPostingLocation(value) {
  const locations = asArray(value)
    .map((location) => {
      const address = location?.address || {};
      return [
        address.addressLocality,
        address.addressRegion,
        address.addressCountry,
      ].filter(Boolean).join(', ');
    })
    .filter(Boolean);
  return locations.join(' / ') || 'a confirmar';
}

function extractLandingJobsUrls(html, baseUrl) {
  const anchors = extractAnchors(html, baseUrl);
  const urls = new Set();

  for (const anchor of anchors) {
    const url = normalizeText(anchor.href);
    if (!url.includes('landing.jobs/jobs/')) continue;
    if (url.includes('/jobs/for/') || url.includes('/jobs?') || url.endsWith('/jobs')) continue;
    urls.add(anchor.href.split('?')[0]);
  }

  return [...urls];
}

function extractLandingCompany(html) {
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (!ogTitle) return '';
  const parts = stripHtml(ogTitle).split(/ at | - /i).map((part) => normalizeWhitespace(part));
  return parts.length > 1 ? parts.at(-1) : '';
}

function extractNoesisPostings(html, baseUrl) {
  const postings = [];
  const blocks = html.split(/<a\s+class=["'][^"']*job-card[^"']*["'][^>]*href=["']/i).slice(1);

  for (const block of blocks) {
    const hrefMatch = block.match(/^([^"']+)/);
    const href = hrefMatch ? new URL(hrefMatch[1], baseUrl).toString() : '';
    const title = stripHtml(block.match(/<div\s+class=["']title["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');
    const detailsHtml = block.match(/<div\s+class=["']details["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
    const details = [...detailsHtml.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)]
      .map((match) => normalizeWhitespace(stripHtml(match[1])))
      .filter(Boolean);

    if (!href || !title) continue;
    postings.push({
      title,
      link: href,
      location: details[0] || 'a confirmar',
      work_mode: details.find((detail) => hasAny(detail, ['hibrido', 'hybrid', 'remote', 'remoto', 'presencial'])) || 'a confirmar',
      description: details.join(' '),
    });
  }

  return postings;
}

function extractTeamtailorPostings(html, baseUrl) {
  const anchors = extractAnchors(html, baseUrl);
  const postings = [];
  const seen = new Set();

  for (const anchor of anchors) {
    if (!isTeamtailorJobUrl(anchor.href)) continue;
    const link = anchor.href.split('?')[0];
    if (seen.has(link)) continue;
    seen.add(link);

    postings.push({
      title: cleanTitle(anchor.text) || titleFromUrlSlug(link),
      link,
      location: inferLocationFromUrlAndText(link, anchor.text),
      description: anchor.text,
    });
  }

  const linkedUrls = [...html.matchAll(/href=["']([^"']*\/jobs\/[^"']+)["']/gi)]
    .map((match) => {
      try {
        return new URL(match[1].replace(/&amp;/g, '&'), baseUrl).toString().split('?')[0];
      } catch {
        return '';
      }
    })
    .filter(Boolean);

  for (const link of linkedUrls) {
    if (!isTeamtailorJobUrl(link) || seen.has(link)) continue;
    seen.add(link);
    postings.push({
      title: titleFromUrlSlug(link),
      link,
      location: inferLocationFromUrlAndText(link, ''),
      description: '',
    });
  }

  return postings;
}

function extractLeverPostings(html, baseUrl) {
  const postings = [];
  const blocks = html.split(/<div\s+class=["']posting["'][^>]*>/i).slice(1);

  for (const block of blocks) {
    const title = stripHtml(block.match(/data-qa=["']posting-name["'][^>]*>([\s\S]*?)<\/h5>/i)?.[1] || '');
    const href = block.match(/<a\s+class=["']posting-title["'][^>]*href=["']([^"']+)["']/i)?.[1]
      || block.match(/href=["'](https:\/\/jobs\.lever\.co\/[^"']+)["']/i)?.[1]
      || '';
    const categories = [...block.matchAll(/<span[^>]+class=["'][^"']*posting-category[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)]
      .map((match) => normalizeWhitespace(stripHtml(match[1])))
      .filter(Boolean);
    const workMode = normalizeWhitespace(stripHtml(block.match(/class=["'][^"']*workplaceTypes[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || ''));
    const location = categories.at(-1) || normalizeWhitespace(stripHtml(block.match(/class=["'][^"']*location[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || ''));

    if (!title || !href) continue;
    postings.push({
      title,
      link: new URL(href, baseUrl).toString(),
      location: location || 'a confirmar',
      work_mode: workMode.replace(/[-\u2013\u2014]+$/, '') || 'a confirmar',
      description: categories.join(' '),
    });
  }

  return postings;
}

function extractAshbyAppData(html) {
  const match = html.match(/window\.__appData\s*=\s*({[\s\S]*?});\s*(?:fetch|<\/script>)/);
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function findAshbyPostings(data) {
  if (!data || typeof data !== 'object') return [];
  const direct = data.jobBoard?.jobPostings || data.jobBoard?.postings || data.jobPostings || data.postings;
  if (Array.isArray(direct)) return direct;

  const seen = new Set();
  const queue = [data];
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);

    if (Array.isArray(item)) {
      if (item.some((entry) => entry && typeof entry === 'object' && entry.title && (entry.jobPostingId || entry.id))) {
        return item.filter((entry) => entry && typeof entry === 'object' && entry.title && (entry.jobPostingId || entry.id));
      }
      queue.push(...item);
      continue;
    }

    queue.push(...Object.values(item));
  }

  return [];
}

function ashbySlug(url) {
  try {
    return new URL(url).pathname.split('/').filter(Boolean)[0] || '';
  } catch {
    return '';
  }
}

function postingLinkFromAshby(slug, posting) {
  const id = posting.id || posting.jobPostingId;
  if (!slug || !id) return '';
  return `https://jobs.ashbyhq.com/${slug}/${id}`;
}

function ashbyLocation(posting) {
  const locations = [
    posting.locationName,
    posting.locationExternalName,
    ...asArray(posting.secondaryLocations).map((location) => location.locationExternalName || location.locationName),
  ].filter(Boolean);
  return [...new Set(locations)].slice(0, 6).join(' / ') || 'a confirmar';
}

function ashbyDescription(detailPosting, listPosting) {
  const posting = detailPosting || listPosting || {};
  const sections = [
    posting.descriptionHtml,
    posting.description,
    posting.descriptionPlain,
    posting.descriptionOpening,
    posting.descriptionClosing,
    posting.departmentName,
    posting.teamName,
    posting.employmentType,
    posting.workplaceType,
    ashbyLocation(posting),
  ].filter(Boolean);
  return stripHtml(sections.join('\n'));
}

function isNoesisCompany(company) {
  return normalizeText(company.name || '').includes('noesis') || normalizeText(company.careers_url || '').includes('opportunities.noesis.pt');
}

function isConfiguredAdapter(company, adapter) {
  return normalizeText(company.adapter || '').replace(/[^a-z0-9]+/g, '_') === adapter;
}

function hasConfiguredAdapter(company, adapters) {
  const configured = normalizeText(company.adapter || '').replace(/[^a-z0-9]+/g, '_');
  return adapters.includes(configured);
}

function shouldUseBrowserFallback(company) {
  return hasConfiguredAdapter(company, ['browser', 'playwright', 'browser_fallback', 'workday']);
}

function isTeamtailorJobUrl(url) {
  const text = normalizeText(url);
  return /\/jobs\/\d+/.test(text) || text.includes('teamtailor') && text.includes('/jobs/');
}

function isLandingJobsUrl(url) {
  return normalizeText(url).includes('landing.jobs/');
}

function isGreenhouseUrl(url) {
  return normalizeText(url).includes('greenhouse.io/');
}

function isSmartRecruitersUrl(url) {
  return normalizeText(url).includes('smartrecruiters.com/');
}

function isWorkableUrl(url) {
  const text = normalizeText(url || '');
  return text.includes('apply.workable.com/') || text.includes('workable.com');
}

function isWorkdayApiUrl(url) {
  const text = normalizeText(url || '');
  return text.includes('/wday/cxs/') && text.endsWith('/jobs');
}

function isWorkdayUrl(url) {
  const text = normalizeText(url || '');
  return text.includes('myworkdayjobs.com/') || text.includes('workdayjobs.com/');
}

function deriveSmartRecruitersApiUrl(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const companySlug = parts[0];
    if (!companySlug || !isSmartRecruitersUrl(url)) return '';
    return `https://api.smartrecruiters.com/v1/companies/${companySlug}/postings?limit=100`;
  } catch {
    return '';
  }
}

function smartRecruitersPostingLink(careersUrl, postingId) {
  if (!postingId) return careersUrl;
  try {
    const parsed = new URL(careersUrl);
    const companySlug = parsed.pathname.split('/').filter(Boolean)[0];
    if (!companySlug) return careersUrl;
    return `https://jobs.smartrecruiters.com/${companySlug}/${postingId}`;
  } catch {
    return careersUrl;
  }
}

function smartRecruitersLocation(posting) {
  const location = posting.location || {};
  return location.fullLocation || [
    location.city,
    location.region,
    location.country,
  ].filter(Boolean).join(', ');
}

function deriveWorkableJobsMarkdownUrl(url, html = '') {
  const fromHref = String(html || '').match(/https:\/\/apply\.workable\.com\/([^/"'?\s]+)\/?/i)?.[1];
  const fromMeta = String(html || '').match(/<meta[^>]+name=["']subdomain["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const fromUrl = workableSlugFromUrl(url);
  const slug = fromHref || fromMeta || fromUrl;
  return slug ? `https://apply.workable.com/${slug}/jobs.md` : '';
}

async function discoverWorkableJobsMarkdownUrl(careersUrl) {
  try {
    const llmsUrl = new URL('/_/llms.txt', careersUrl).toString();
    const response = await fetchText(llmsUrl, 12000);
    return response.text.match(/GET\s+`([^`]+jobs\.md)`/i)?.[1]
      || response.text.match(/https:\/\/apply\.workable\.com\/[^\s`]+\/jobs\.md/i)?.[0]
      || '';
  } catch {
    return '';
  }
}

function workableSlugFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (!normalizeText(parsed.hostname).includes('apply.workable.com')) return '';
    return parsed.pathname.split('/').filter(Boolean)[0] || '';
  } catch {
    return '';
  }
}

function extractWorkableMarkdownPostings(markdown) {
  const postings = [];
  for (const line of String(markdown || '').split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    if (/^\|\s*-+/.test(line) || /title\s*\|\s*department/i.test(line)) continue;
    const cells = splitMarkdownTableRow(line);
    if (cells.length < 7) continue;
    const detail = cells[6].match(/\((https?:\/\/[^)]+)\)/)?.[1] || '';
    postings.push({
      title: markdownCellText(cells[0]),
      department: markdownCellText(cells[1]),
      location: markdownCellText(cells[2]),
      type: markdownCellText(cells[3]),
      salary: markdownCellText(cells[4]).replace(/^—$/, ''),
      posted: markdownCellText(cells[5]),
      detail,
    });
  }
  return postings;
}

function splitMarkdownTableRow(line) {
  return String(line)
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function markdownCellText(value) {
  return normalizeWhitespace(String(value || '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/—/g, '—'));
}

function markdownToText(value) {
  return normalizeWhitespace(String(value || '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_`~]+/g, ' ')
    .replace(/<[^>]+>/g, ' '));
}

function workablePublicJobUrl(url) {
  const text = String(url || '');
  const match = text.match(/https:\/\/apply\.workable\.com\/([^/]+)\/jobs\/view\/([^/.]+)\.md/i);
  if (match) return `https://apply.workable.com/${match[1]}/j/${match[2]}/`;
  return text.replace(/\.md$/i, '');
}

function isPortugalScopedCompany(company) {
  return companyGroupFor(company).startsWith('portugal');
}

function isPortugalLocation(locationText, posting = {}) {
  const location = posting.location || {};
  const text = normalizeText([
    locationText,
    location.country,
    location.fullLocation,
    location.city,
    location.region,
  ].filter(Boolean).join(' '));
  return hasAny(text, ['portugal', 'pt', 'lisboa', 'lisbon', 'porto', 'coimbra', 'aveiro', 'braga']);
}

function deriveWorkdayApiUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (!normalizeText(host).includes('myworkdayjobs.com')) return '';
    const tenant = host.split('.')[0];
    const site = parsed.pathname.split('/').filter(Boolean)[0];
    if (!tenant || !site) return '';
    return `https://${host}/wday/cxs/${tenant}/${site}/jobs`;
  } catch {
    return '';
  }
}

function workdayPostingLink(apiUrl, externalPath) {
  try {
    const parsed = new URL(apiUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const site = parts[3] || '';
    if (!site || !externalPath) return '';
    return `https://${parsed.hostname}/${site}${externalPath}`;
  } catch {
    return '';
  }
}

function isYcJobUrl(url) {
  try {
    const parsed = new URL(url);
    return normalizeText(parsed.hostname).includes('ycombinator.com') &&
      /\/companies\/[^/]+\/jobs\/[^/]+/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function companyFromYcUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const company = parts[1] || '';
    return company ? cleanTitle(company.split('-').map(capitalize).join(' ')) : '';
  } catch {
    return '';
  }
}

function isWeWorkRemotelyJobUrl(url) {
  try {
    const parsed = new URL(url);
    return normalizeText(parsed.hostname).includes('weworkremotely.com') &&
      /\/remote-jobs\/[^/]+/.test(parsed.pathname) &&
      !normalizeText(parsed.pathname).includes('/search');
  } catch {
    return false;
  }
}

function companyFromWeWorkRemotelyText(text) {
  const cleaned = normalizeWhitespace(text || '');
  if (!cleaned) return '';
  const separators = [' - ', ' at ', ' @ '];
  for (const separator of separators) {
    const index = cleaned.toLowerCase().indexOf(separator.trim() === 'at' ? ' at ' : separator);
    if (index > 0) {
      const company = cleaned.slice(0, index).trim();
      if (company && company.length <= 80) return company;
    }
  }
  return '';
}

function parseWeWorkRemotelySlug(url) {
  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    const parts = slug.split('-').filter(Boolean);
    if (parts.length < 2) return { company: '', title: titleFromUrlSlug(url) };

    const company = cleanTitle(parts[0].split('-').map(capitalize).join(' '));
    const title = cleanTitle(parts.slice(1).map(capitalize).join(' '));
    return { company, title };
  } catch {
    return { company: '', title: '' };
  }
}

function isAshbyUrl(url) {
  return normalizeText(url).includes('jobs.ashbyhq.com/');
}

function isLeverUrl(url) {
  return normalizeText(url).includes('jobs.lever.co/');
}

function deriveGreenhouseApiUrl(url) {
  try {
    const parsed = new URL(url);
    if (!normalizeText(parsed.hostname).includes('greenhouse.io')) return '';
    const slug = parsed.pathname.split('/').filter(Boolean)[0];
    return slug ? `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs` : '';
  } catch {
    return '';
  }
}

function withGreenhouseContent(apiUrl) {
  if (!apiUrl) return '';

  try {
    const parsed = new URL(apiUrl);
    if (normalizeText(parsed.hostname).includes('greenhouse.io')) {
      parsed.searchParams.set('content', 'true');
    }
    return parsed.toString();
  } catch {
    return apiUrl;
  }
}

function isPastDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date < new Date(`${todayISO()}T00:00:00.000Z`);
}

function capitalize(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function titleFromUrlSlug(url) {
  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    return cleanTitle(slug.split('-').map(capitalize).join(' '));
  } catch {
    return 'a confirmar';
  }
}

function withPageParam(url, pageNumber) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('page', String(pageNumber));
    return parsed.toString();
  } catch {
    return url;
  }
}

function loadSeenUrls(root) {
  const urls = new Set();
  const files = [
    join(root, 'data', 'scan-history.tsv'),
    join(root, 'data', 'pipeline.md'),
    join(root, 'data', 'applications.md'),
  ];

  for (const file of files) {
    if (!existsSync(file)) continue;
    const matches = readFileSync(file, 'utf-8').match(/https?:\/\/[^\s|)\]]+/g) || [];
    for (const match of matches) {
      urls.add(match.replace(/[.,;]+$/, ''));
    }
  }

  return urls;
}

function companyGroupFor(company) {
  const name = normalizeText(company.name || '');
  const text = normalizeText(`${company.name || ''} ${company.careers_url || ''} ${company.scan_query || ''} ${company.notes || ''}`);

  if (PORTUGAL_PRIORITY_COMPANIES.has(name)) return 'portugal_priority';
  if (hasAny(text, ['portugal', 'lisboa', 'lisbon', 'porto', 'coimbra', 'aveiro', 'braga', '.pt/'])) return 'portugal_general';
  if (hasAny(text, ['remote eu', 'remote europe', 'europe', 'emea', 'germany', 'berlin', 'dach', 'paris', 'london', 'zurich', 'amsterdam', 'madrid', 'barcelona'])) return 'remote_europe';
  if (isAshbyUrl(company.careers_url) || isLeverUrl(company.careers_url) || isGreenhouseUrl(company.careers_url)) return 'global';
  return 'global';
}

function companyPriority(company) {
  const name = normalizeText(company.name || '');
  const text = normalizeText(`${company.name || ''} ${company.careers_url || ''} ${company.notes || ''}`);
  if (PORTUGAL_PRIORITY_COMPANIES.has(name)) return 100;
  if (hasAny(text, ['portugal', 'lisboa', 'lisbon', 'porto', '.pt/'])) return 60;
  if (hasAny(text, ['remote eu', 'remote europe', 'europe'])) return 30;
  return 0;
}

function writeScanSnapshot(root, result, dryRun) {
  const dir = join(root, 'data', 'scans');
  mkdirSync(dir, { recursive: true });
  const suffix = dryRun ? 'dry-run' : 'scan';
  const file = join(dir, `${todayISO()}-${suffix}.json`);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, 'utf-8');
  return file;
}

function appendScanHistory(root, jobs, status) {
  const file = join(root, 'data', 'scan-history.tsv');
  const header = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n';
  if (!existsSync(file)) writeFileSync(file, header, 'utf-8');
  const existingUrls = new Set(readFileSync(file, 'utf-8')
    .split('\n')
    .slice(1)
    .map((line) => line.split('\t')[0])
    .filter(Boolean));
  const rows = jobs.filter((job) => !existingUrls.has(job.link)).map((job) => [
    job.link,
    job.first_seen || todayISO(),
    job.source || 'scanner',
    job.title,
    job.company,
    status,
  ].map(tsvCell).join('\t'));
  if (rows.length > 0) appendFileSync(file, `${rows.join('\n')}\n`, 'utf-8');
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    includeSeen: false,
    refreshKnown: false,
    limit: 30,
    profile: '',
    source: '',
    writeSnapshot: true,
    updateHistory: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--new-only') options.includeSeen = false;
    else if (arg === '--audit') options.includeSeen = true;
    else if (arg === '--refresh-known') {
      options.includeSeen = true;
      options.refreshKnown = true;
    }
    else if (arg === '--include-seen') options.includeSeen = true;
    else if (arg === '--snapshot') options.writeSnapshot = true;
    else if (arg === '--no-snapshot') options.writeSnapshot = false;
    else if (arg === '--no-job-boards') options.jobBoards = false;
    else if (arg === '--update-history') options.updateHistory = true;
    else if (arg === '--limit') options.limit = Number(argv[++index] || options.limit);
    else if (arg === '--profile') options.profile = argv[++index] || '';
    else if (arg === '--source') options.source = argv[++index] || '';
  }

  if (options.dryRun) {
    options.updateHistory = false;
    if (!argv.includes('--snapshot')) options.writeSnapshot = false;
  }
  return options;
}

function printScanResult(result) {
  console.log(`\nScan complete: ${result.total_candidates} candidate(s). Mode: ${result.scan_mode || 'new-only'}.`);
  if (Number.isFinite(result.known_index_size)) console.log(`Known index size: ${result.known_index_size}`);
  if (result.snapshot_path) console.log(`Snapshot: ${relativePath(result.snapshot_path)}`);

  for (const job of result.candidates.slice(0, 20)) {
    console.log(`- ${job.company} | ${job.title} | ${job.location} | ${job.link}`);
  }

  printSourceStats(result.source_stats || []);

  if (result.errors.length > 0) {
    console.log(`\nErrors: ${result.errors.length}`);
    for (const error of result.errors.slice(0, 10)) {
      console.log(`- ${error.company}: ${error.error}`);
    }
  }

  if (result.skipped.length > 0) {
    console.log(`Skipped: ${result.skipped.length}`);
    const byReason = countBy(result.skipped, 'reason');
    const summary = Object.entries(byReason).slice(0, 8).map(([reason, count]) => `${reason}: ${count}`).join(', ');
    if (summary) console.log(`Skipped summary: ${summary}`);
  }
}

function printSourceStats(sourceStats) {
  if (sourceStats.length === 0) return;

  console.log('\nSource diagnostics:');
  for (const stat of sourceStats.slice(0, 25)) {
    const errorText = stat.error ? ` | ERROR: ${stat.error}` : '';
    console.log(`- ${stat.source} [${stat.type}]: found ${stat.discovered}, accepted ${stat.accepted}, skipped ${stat.skipped}${errorText}`);
  }
  if (sourceStats.length > 25) console.log(`- ... ${sourceStats.length - 25} more source(s)`);
}

function relativePath(file) {
  return file.replace(`${projectRoot}\\`, '').replace(`${projectRoot}/`, '');
}

function hasAny(text, needles) {
  const source = normalizeText(text);
  return needles.some((needle) => source.includes(normalizeText(needle)));
}

function tsvCell(value) {
  return normalizeWhitespace(value).replace(/\t/g, ' ');
}

function countBy(values, key) {
  const counts = {};
  for (const value of values) {
    const name = value?.[key] || 'unknown';
    counts[name] = (counts[name] || 0) + 1;
  }
  return counts;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  runScan(options)
    .then(printScanResult)
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
