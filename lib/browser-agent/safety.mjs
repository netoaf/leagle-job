import { existsSync } from 'fs';
import { join } from 'path';
import { loadYamlFile } from '../config-loader.mjs';
import { normalizeText } from '../job-normalizer.mjs';
import { assertSafeNavigationUrl } from '../network/playwright-guard.mjs';

const DEFAULT_CONFIG = {
  enabled: false,
  provider: 'playwright_local',
  mode: 'extraction_only',
  output_dir: 'output/browser-agent',
  defaults: {
    headless: true,
    write_outputs: false,
    score_after_extract: false,
  },
  scanner: {
    enabled: true,
    use_only_when_adapter_is_browser_agent: true,
    write_outputs_from_scanner: false,
    recommended_for: ['single_job_pages', 'javascript_rendered_job_pages'],
  },
  extraction: {
    timeout_ms: 25000,
    wait_until: 'domcontentloaded',
    max_text_chars: 12000,
    block_resource_types: ['image', 'media', 'font'],
    remove_selectors: ['script', 'style', 'noscript', 'svg', 'header', 'footer', 'nav', 'aside'],
  },
  safety: {
    human_review_required: true,
    never_submit: true,
    allow_form_fill: false,
    allow_file_upload: false,
    allow_email_send: false,
    allow_external_api: false,
    allowed_actions: ['check', 'extract', 'score'],
    forbidden_actions: ['submit_application', 'send_email', 'click_submit', 'upload_cv', 'type_sensitive_data'],
    blocked_url_patterns: ['accounts.google.com', 'login', 'signin', 'auth', 'checkout', 'payment'],
  },
  providers: {
    playwright_local: {
      enabled: true,
      requires_api_key: false,
      requires_login: false,
    },
  },
};

export function loadBrowserAgentConfig(projectRoot) {
  const file = join(projectRoot, 'config', 'browser-agent.yml');
  if (!existsSync(file)) return DEFAULT_CONFIG;
  const parsed = loadYamlFile(file);
  return mergeConfig(DEFAULT_CONFIG, parsed.browser_agent || {});
}

export function validateBrowserAgentConfig(config) {
  const errors = [];
  const warnings = [];

  if (!config || typeof config !== 'object') {
    return { errors: ['browser-agent config did not load as an object.'], warnings };
  }

  const provider = config.provider || '';
  const providerConfig = config.providers?.[provider];
  if (!provider) errors.push('browser_agent.provider is required.');
  if (!providerConfig) errors.push(`browser_agent.providers.${provider} is missing.`);
  if (providerConfig && providerConfig.enabled === false) {
    errors.push(`browser agent provider "${provider}" is disabled.`);
  }

  if (config.mode !== 'extraction_only') {
    warnings.push('Only extraction_only mode is supported by the safe local browser agent.');
  }

  if (config.safety?.never_submit !== true) {
    errors.push('browser_agent.safety.never_submit must be true.');
  }
  if (config.safety?.human_review_required !== true) {
    errors.push('browser_agent.safety.human_review_required must be true.');
  }
  if (config.safety?.allow_form_fill === true) {
    errors.push('browser_agent.safety.allow_form_fill must remain false in this implementation.');
  }
  if (config.safety?.allow_file_upload === true) {
    errors.push('browser_agent.safety.allow_file_upload must remain false in this implementation.');
  }
  if (config.safety?.allow_email_send === true) {
    errors.push('browser_agent.safety.allow_email_send must remain false in this implementation.');
  }

  if (providerConfig?.requires_api_key && provider !== 'playwright_local') {
    warnings.push(`Provider "${provider}" requires an API key. Do not store it in the repo.`);
  }

  return { errors, warnings };
}

export function assertBrowserAgentAction(config, action) {
  if (config.enabled !== true) {
    throw new Error('Browser agent is disabled in config/browser-agent.yml.');
  }

  const allowed = asArray(config.safety?.allowed_actions).map(normalizeText);
  const forbidden = asArray(config.safety?.forbidden_actions).map(normalizeText);
  const normalizedAction = normalizeText(action);

  if (forbidden.includes(normalizedAction)) {
    throw new Error(`Blocked browser-agent action: ${action}`);
  }
  if (allowed.length > 0 && !allowed.includes(normalizedAction)) {
    throw new Error(`Browser-agent action is not allowed by config: ${action}`);
  }
}

export async function assertSafeUrl(config, url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported browser-agent protocol: ${parsed.protocol}`);
  }

  const source = normalizeText(parsed.href);
  const blocked = asArray(config.safety?.blocked_url_patterns)
    .map(normalizeText)
    .filter(Boolean)
    .find((pattern) => source.includes(pattern));

  if (blocked) {
    throw new Error(`URL blocked by browser-agent safety policy: ${blocked}`);
  }

  await assertSafeNavigationUrl(parsed);
}

export function browserAgentPolicySummary(config) {
  const provider = config.provider || 'unknown';
  const providerConfig = config.providers?.[provider] || {};
  return {
    enabled: config.enabled === true,
    provider,
    mode: config.mode || 'unknown',
    human_review_required: config.safety?.human_review_required === true,
    never_submit: config.safety?.never_submit === true,
    allow_form_fill: config.safety?.allow_form_fill === true,
    allow_file_upload: config.safety?.allow_file_upload === true,
    allow_email_send: config.safety?.allow_email_send === true,
    provider_requires_api_key: providerConfig.requires_api_key === true,
    provider_requires_login: providerConfig.requires_login === true,
  };
}

function mergeConfig(base, override) {
  const result = { ...base, ...override };
  result.defaults = { ...base.defaults, ...(override.defaults || {}) };
  result.scanner = { ...base.scanner, ...(override.scanner || {}) };
  result.extraction = { ...base.extraction, ...(override.extraction || {}) };
  result.safety = { ...base.safety, ...(override.safety || {}) };
  result.providers = { ...base.providers, ...(override.providers || {}) };
  return result;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}
