/**
 * Phase 1A — connector permissions table.
 *
 * Brief mandate: every user-facing permission string must be plain
 * English, NEVER mention OAuth scopes, tokens, client secrets, bearer
 * jargon, or developer concepts. These tests are the regression net.
 */
import { describe, it, expect } from 'vitest';
import {
  CONNECTOR_PERMISSIONS,
  DEFAULT_CONNECTOR_PERMISSIONS,
  getConnectorPermissions,
} from '../../../apps/web/src/lib/connector-permissions';

const FORBIDDEN_DEVELOPER_TERMS = [
  'oauth',
  'scope',
  'scopes',
  'bearer',
  'client_id',
  'client secret',
  'client_secret',
  'access_token',
  'access token',
  'refresh_token',
  'refresh token',
  'webhook',
  'mcp',
  'redirect uri',
  'redirect_uri',
  'graph api',
  'app review',
  'developer credentials',
];

describe('CONNECTOR_PERMISSIONS — plain-English copy', () => {
  it.each(Object.entries(CONNECTOR_PERMISSIONS))(
    '%s permissions never use developer jargon',
    (provider, perms) => {
      const haystack = `${perms.jakCan} ${perms.approvalRequiredBefore}`.toLowerCase();
      for (const term of FORBIDDEN_DEVELOPER_TERMS) {
        expect(
          haystack.includes(term),
          `${provider} permissions string contains forbidden term "${term}". Source: "${haystack}"`,
        ).toBe(false);
      }
    },
  );

  it('default fallback never uses developer jargon', () => {
    const haystack = `${DEFAULT_CONNECTOR_PERMISSIONS.jakCan} ${DEFAULT_CONNECTOR_PERMISSIONS.approvalRequiredBefore}`.toLowerCase();
    for (const term of FORBIDDEN_DEVELOPER_TERMS) {
      expect(haystack.includes(term)).toBe(false);
    }
  });

  it('every connector entry has both `jakCan` and `approvalRequiredBefore`', () => {
    for (const [provider, perms] of Object.entries(CONNECTOR_PERMISSIONS)) {
      expect(perms.jakCan, `${provider}.jakCan`).toBeTruthy();
      expect(perms.approvalRequiredBefore, `${provider}.approvalRequiredBefore`).toBeTruthy();
    }
  });

  it('every shipped connector exists in the table (no missing strings)', () => {
    const SHIPPED_PROVIDERS = ['GMAIL', 'GCAL', 'SLACK', 'GITHUB', 'NOTION', 'HUBSPOT', 'DRIVE'];
    for (const p of SHIPPED_PROVIDERS) {
      expect(CONNECTOR_PERMISSIONS[p], `${p} entry`).toBeDefined();
    }
  });
});

describe('getConnectorPermissions', () => {
  it('returns the table entry for known providers', () => {
    expect(getConnectorPermissions('GMAIL').jakCan).toBe(CONNECTOR_PERMISSIONS['GMAIL']!.jakCan);
  });

  it('returns the default fallback for unknown providers', () => {
    const unknown = getConnectorPermissions('SOME_NEW_THING_2026');
    expect(unknown.jakCan).toBe(DEFAULT_CONNECTOR_PERMISSIONS.jakCan);
  });

  it('case-insensitive lookup', () => {
    expect(getConnectorPermissions('gmail').jakCan).toBe(CONNECTOR_PERMISSIONS['GMAIL']!.jakCan);
  });
});
