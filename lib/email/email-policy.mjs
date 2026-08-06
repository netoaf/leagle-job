import { existsSync } from 'fs';
import { join } from 'path';
import { loadYamlFile } from '../config-loader.mjs';

export const DEFAULT_EMAIL_CONFIG = {
  enabled: false,
  provider: 'gmail',
  mode: 'draft_only',
  human_review_required: true,
  auto_send: false,
  allow_real_gmail_drafts: false,
  allow_cv_attachment_in_gmail: false,
  drafts: {
    store: 'data/email-drafts.tsv',
    local_output_dir: 'output/email-drafts-local',
    default_to: 'a confirmar',
    subject_prefix: 'Candidatura',
  },
  attachments: {
    planned_cv_pdf: 'output/CV-Candidate.pdf',
    require_explicit_attachment_approval: true,
  },
  sync: {
    read_replies: false,
    update_application_status: false,
    newer_than_days: 30,
  },
  labels: {
    draft_label: 'Leagle Job/Drafts',
    sent_label: 'Leagle Job/Sent',
    reply_label: 'Leagle Job/Replies',
    needs_review_label: 'Leagle Job/Needs Review',
  },
  safety: {
    require_draft_quality_gate: true,
    require_recipient_confirmed: true,
    require_application_pack: true,
    never_send_without_approval: true,
  },
};

export function loadEmailConfig(projectRoot) {
  const file = join(projectRoot, 'config', 'email.yml');
  if (!existsSync(file)) return DEFAULT_EMAIL_CONFIG;
  return mergeConfig(DEFAULT_EMAIL_CONFIG, loadYamlFile(file));
}

export function validateEmailConfig(config = DEFAULT_EMAIL_CONFIG) {
  const errors = [];
  const warnings = [];

  if (config.provider !== 'gmail') warnings.push('Only gmail is planned for now; other providers are treated as local-only.');
  if (config.mode !== 'draft_only' && config.mode !== 'off') errors.push('email mode must be draft_only or off.');
  if (config.auto_send === true) errors.push('auto_send must stay false.');
  if (config.human_review_required !== true) errors.push('human_review_required must stay true.');
  if (config.safety?.never_send_without_approval !== true) errors.push('never_send_without_approval must stay true.');
  if (config.allow_real_gmail_drafts === true && config.enabled !== true) {
    warnings.push('real Gmail drafts are allowed but email integration is disabled.');
  }
  if (config.allow_cv_attachment_in_gmail === true && config.attachments?.require_explicit_attachment_approval !== true) {
    errors.push('CV Gmail attachment requires explicit attachment approval.');
  }
  if (!config.drafts?.store) errors.push('drafts.store is required.');
  if (!config.drafts?.local_output_dir) errors.push('drafts.local_output_dir is required.');

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function assertEmailPolicy(config = DEFAULT_EMAIL_CONFIG) {
  const validation = validateEmailConfig(config);
  if (!validation.ok) {
    throw new Error(`email_policy_invalid: ${validation.errors.join('; ')}`);
  }
  return validation;
}

export function emailPolicySummary(config = DEFAULT_EMAIL_CONFIG) {
  return {
    enabled: config.enabled === true,
    provider: config.provider,
    mode: config.mode,
    local_store: config.drafts?.store,
    local_output_dir: config.drafts?.local_output_dir,
    real_gmail_drafts: config.allow_real_gmail_drafts === true,
    auto_send: config.auto_send === true,
    human_review_required: config.human_review_required === true,
    cv_gmail_attachment_allowed: config.allow_cv_attachment_in_gmail === true,
  };
}

function mergeConfig(base, override = {}) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object') {
      result[key] = mergeConfig(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
