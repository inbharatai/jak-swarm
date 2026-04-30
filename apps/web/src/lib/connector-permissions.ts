/**
 * Plain-English permission strings per connector.
 *
 * Brief: normal users must NEVER see OAuth scopes, bearer tokens, client
 * secrets, redirect URIs, or any developer jargon. They see "JAK can read
 * your inbox and draft replies. Approval required before sending." in
 * their own language.
 *
 * Source-of-truth: backend connector definitions decide actual scopes.
 * This file is the USER-FACING translation layer — keep it in sync when
 * adding new connectors.
 *
 * Brief mandate: "Use safer language: Connect supported tools, generate
 * reports, and execute approved actions. More connectors are being added.
 * Do not overpromise. Accuracy is more important than hype."
 */

export type ConnectorReadiness = 'oauth_ready' | 'admin_setup_needed' | 'coming_soon';

export interface ConnectorPermissions {
  /** What JAK can do once connected, in plain English. ≤2 sentences. */
  jakCan: string;
  /** Actions that always pause for approval, in plain English. ≤2 sentences. */
  approvalRequiredBefore: string;
  /** Honest user-facing readiness: oauth_ready / admin_setup_needed / coming_soon. */
  readinessHint?: ConnectorReadiness;
}

/**
 * Keyed by `IntegrationProvider` enum values from `apps/web/src/types`.
 * Missing-key fallback returns generic strings so a new connector never
 * crashes the modal — it just shows minimal copy until this map is
 * updated.
 */
export const CONNECTOR_PERMISSIONS: Record<string, ConnectorPermissions> = {
  GMAIL: {
    jakCan: 'Read your inbox, summarize threads, and draft replies.',
    approvalRequiredBefore: 'Sending an email, deleting messages, or modifying labels.',
    readinessHint: 'oauth_ready',
  },
  GCAL: {
    jakCan: 'Read your calendar, find free time, and draft event invites.',
    approvalRequiredBefore: 'Creating, updating, or deleting events.',
    readinessHint: 'oauth_ready',
  },
  SLACK: {
    jakCan: 'Read channels you invite the bot into and draft messages.',
    approvalRequiredBefore: 'Posting messages, sending DMs, or creating channels.',
    readinessHint: 'oauth_ready',
  },
  GITHUB: {
    jakCan: 'Read repositories you select, review code, and draft fixes.',
    approvalRequiredBefore: 'Pushing commits, opening pull requests, or merging.',
    readinessHint: 'oauth_ready',
  },
  NOTION: {
    jakCan: 'Read pages you share with JAK and draft new pages.',
    approvalRequiredBefore: 'Creating, updating, or deleting Notion pages.',
    readinessHint: 'oauth_ready',
  },
  HUBSPOT: {
    jakCan: 'Read CRM contacts, deals, and pipelines you grant access to.',
    approvalRequiredBefore: 'Updating CRM records, sending emails to contacts, or modifying pipelines.',
    readinessHint: 'oauth_ready',
  },
  DRIVE: {
    jakCan: 'Read files in folders you share, summarize documents, and draft new files.',
    approvalRequiredBefore: 'Editing, deleting, sharing, or moving files.',
    readinessHint: 'oauth_ready',
  },
  LINKEDIN: {
    jakCan: 'Review your profile and draft posts.',
    approvalRequiredBefore: 'Publishing posts, sending messages, or editing your profile.',
    readinessHint: 'admin_setup_needed',
  },
  SALESFORCE: {
    jakCan: 'Read CRM accounts, opportunities, and reports you grant access to.',
    approvalRequiredBefore: 'Updating CRM records, modifying opportunities, or running mass operations.',
    readinessHint: 'admin_setup_needed',
  },
};

/**
 * Generic fallback for connectors not yet in the permissions map. Honest
 * — never overclaims. The modal always shows SOMETHING readable rather
 * than crashing on a missing key.
 */
export const DEFAULT_CONNECTOR_PERMISSIONS: ConnectorPermissions = {
  jakCan: 'Read what you allow and draft suggested actions.',
  approvalRequiredBefore: 'Any change that affects your account or data outside JAK.',
  readinessHint: 'admin_setup_needed',
};

export function getConnectorPermissions(provider: string): ConnectorPermissions {
  return CONNECTOR_PERMISSIONS[provider.toUpperCase()] ?? DEFAULT_CONNECTOR_PERMISSIONS;
}
