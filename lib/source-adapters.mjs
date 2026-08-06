import { normalizeText } from './job-normalizer.mjs';

const ADAPTER_RULES = [
  {
    adapter: 'greenhouse',
    url: ['greenhouse.io/', 'boards.greenhouse.io/', 'job-boards.greenhouse.io/', 'job-boards.eu.greenhouse.io/'],
    html: ['greenhouse', 'grnh.se'],
    scanner: 'existing',
  },
  {
    adapter: 'ashby',
    url: ['jobs.ashbyhq.com/'],
    html: ['__appdata', 'ashby'],
    scanner: 'existing',
  },
  {
    adapter: 'lever',
    url: ['jobs.lever.co/'],
    html: ['lever.co', 'posting-title', 'data-qa="posting-name"'],
    scanner: 'existing',
  },
  {
    adapter: 'landing_jobs',
    url: ['landing.jobs/'],
    html: ['landing.jobs/jobs'],
    scanner: 'existing',
  },
  {
    adapter: 'noesis_bizneo',
    url: ['opportunities.noesis.pt/'],
    html: ['job-card', 'bizneo'],
    scanner: 'existing',
  },
  {
    adapter: 'workday',
    url: ['myworkdayjobs.com/', 'workdayjobs.com/', '.wd1.myworkdayjobs.com/'],
    html: ['workday', 'wd1.myworkdayjobs'],
    scanner: 'existing',
  },
  {
    adapter: 'smartrecruiters',
    url: ['smartrecruiters.com/'],
    html: ['smartrecruiters', 'jobs.smartrecruiters'],
    scanner: 'existing',
  },
  {
    adapter: 'teamtailor',
    url: ['teamtailor.com/'],
    html: ['teamtailor', 'career.teamtailor'],
    scanner: 'existing',
  },
  {
    adapter: 'workable',
    url: ['apply.workable.com/'],
    html: ['workable', 'apply.workable.com'],
    scanner: 'existing',
  },
  {
    adapter: 'browser_agent',
    url: [],
    html: [],
    scanner: 'existing',
  },
  {
    adapter: 'eightfold',
    url: ['eightfold.ai/'],
    html: ['powered by eightfold', 'app.eightfold.ai', 'eightfold ai logo'],
    scanner: 'existing',
  },
  {
    adapter: 'successfactors',
    url: ['successfactors.', 'jobs.sap.com/', 'career5.successfactors.eu/'],
    html: ['successfactors', 'sap successfactors'],
    scanner: 'needed',
  },
  {
    adapter: 'workable_like',
    url: ['apply.workable.com'],
    html: [],
    scanner: 'needed',
  },
];

export function detectSourceAdapter({ url = '', finalUrl = '', html = '', api = '', adapter = '' } = {}) {
  if (api && normalizeText(api).includes('/wday/cxs/')) {
    return { adapter: 'workday_api', scanner: 'existing', reason: 'api field points to Workday CXS' };
  }

  if (api && normalizeText(api).includes('greenhouse.io')) {
    return { adapter: 'greenhouse_api', scanner: 'existing', reason: 'api field points to Greenhouse' };
  }

  const explicitAdapter = normalizeText(adapter).replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (explicitAdapter) {
    return {
      adapter: explicitAdapter,
      scanner: adapterKnownByScanner(explicitAdapter) ? 'existing' : 'needed',
      reason: 'explicit config',
    };
  }

  const combinedUrl = normalizeText(`${url} ${finalUrl} ${api}`);
  const combinedHtml = normalizeText(html).slice(0, 200000);

  for (const rule of ADAPTER_RULES) {
    if (rule.url.some((needle) => combinedUrl.includes(normalizeText(needle)))) {
      return matchedRuleDetection(rule, html, 'url pattern');
    }
  }

  for (const rule of ADAPTER_RULES) {
    if (rule.html.some((needle) => combinedHtml.includes(normalizeText(needle)))) {
      return matchedRuleDetection(rule, html, 'html pattern');
    }
  }

  if (looksJavascriptRendered(combinedHtml)) {
    return { adapter: 'js_rendered', scanner: 'needed', reason: 'page looks JavaScript-rendered' };
  }

  return { adapter: 'generic_html', scanner: 'existing', reason: 'fallback' };
}

export function classifySourceHealth({ enabled = true, httpCode = 0, error = '', adapter = 'generic_html', scanner = 'existing' } = {}) {
  const message = normalizeText(error);

  if (!enabled) {
    return {
      status: 'disabled',
      next_action: 'skip_until_reenabled',
    };
  }

  if (error) {
    return {
      status: 'fetch_failed',
      next_action: message.includes('abort') || message.includes('timeout')
        ? 'retry_later_or_use_playwright'
        : 'check_url_or_use_playwright',
    };
  }

  if (httpCode === 404 || httpCode === 410) {
    return {
      status: 'dead_url',
      next_action: 'update_careers_url_or_disable_source',
    };
  }

  if (httpCode === 401 || httpCode === 403) {
    return {
      status: 'blocked',
      next_action: 'use_playwright_fallback_or_manual_watch',
    };
  }

  if (httpCode === 429) {
    return {
      status: 'rate_limited',
      next_action: 'add_cache_backoff_and_retry_later',
    };
  }

  if (httpCode >= 500) {
    return {
      status: 'server_error',
      next_action: 'retry_later_before_changing_config',
    };
  }

  if (httpCode >= 300 && httpCode < 400) {
    return {
      status: 'redirect',
      next_action: 'confirm_final_url_and_update_if_stable',
    };
  }

  if (scanner === 'needed') {
    return {
      status: 'needs_adapter',
      next_action: `implement_${adapter}_adapter`,
    };
  }

  return {
    status: 'healthy',
    next_action: 'scan_with_existing_adapter',
  };
}

export function adapterKnownByScanner(adapter) {
  return ['greenhouse', 'greenhouse_api', 'ashby', 'lever', 'landing_jobs', 'noesis_bizneo', 'teamtailor', 'workable', 'workday', 'workday_api', 'smartrecruiters', 'eightfold', 'browser', 'playwright', 'browser_fallback', 'browser_agent', 'generic_html'].includes(adapter);
}

function looksJavascriptRendered(html) {
  if (!html) return false;
  const textLength = html.replace(/\s+/g, ' ').trim().length;
  const scriptCount = (html.match(/<script\b/g) || []).length;
  const anchorCount = (html.match(/<a\b/g) || []).length;
  return scriptCount >= 8 && anchorCount <= 5 && textLength < 80000;
}

function matchedRuleDetection(rule, html, reason) {
  if (rule.adapter === 'successfactors' && hasServerRenderedJobLinks(html)) {
    return {
      adapter: 'generic_html',
      scanner: 'existing',
      reason: 'server-rendered SuccessFactors job links',
    };
  }
  return { adapter: rule.adapter, scanner: rule.scanner, reason };
}

function hasServerRenderedJobLinks(html) {
  const source = String(html || '');
  const jobAnchor = /<a\b[^>]*\bhref\s*=\s*["']((?:https:\/\/[^"']+)?\/job\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = jobAnchor.exec(source))) {
    const text = normalizeText(String(match[2] || '').replace(/<[^>]+>/g, ' '));
    if (text.length >= 4 && text.length <= 180) return true;
  }
  return false;
}
