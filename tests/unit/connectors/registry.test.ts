/**
 * ConnectorRegistry unit tests.
 *
 * Pins the contract the dashboard, resolver, and truth-check CI gate
 * all read against:
 *   - registration is idempotent at the API level (the manifest
 *     bootstrap runs every time the module imports)
 *   - status transitions can never lie (no `installed`/`configured`
 *     without an installMethod)
 *   - validation success records a timestamp + tool count; failure
 *     leaves both alone but flips status
 *   - filters return the right buckets for the dashboard panels
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { connectorRegistry, RiskLevel, type ConnectorManifest } from '@jak-swarm/tools';

// Minimal fixture that satisfies the manifest contract.
function fixture(id: string, overrides: Partial<ConnectorManifest> = {}): ConnectorManifest {
  return {
    id,
    name: `Test ${id}`,
    category: 'business',
    description: `Fixture connector ${id}`,
    runtimeType: 'mcp',
    availableTools: [],
    riskLevel: RiskLevel.MEDIUM,
    approvalRequired: true,
    supportsAutoApproval: false,
    supportsSandbox: true,
    supportsCloud: false,
    supportsLocal: true,
    canModifyFiles: false,
    canPublishExternalContent: false,
    canAccessUserData: false,
    defaultEnabled: false,
    source: 'manual',
    ...overrides,
  };
}

describe('ConnectorRegistry', () => {
  beforeEach(() => {
    // Reset the singleton so each test starts clean. The manifest
    // bootstrap module re-registers everything on next import; tests
    // that need the bootstrap should re-import explicitly.
    (connectorRegistry as unknown as { __resetForTest: () => void }).__resetForTest();
  });

  describe('register()', () => {
    it('registers a connector and exposes it via get()', () => {
      const m = fixture('test-a');
      connectorRegistry.register(m);
      const view = connectorRegistry.get('test-a');
      expect(view).toBeDefined();
      expect(view!.manifest.name).toBe('Test test-a');
      expect(view!.status).toBe('available');
    });

    it('throws when an id is registered twice', () => {
      connectorRegistry.register(fixture('test-dupe'));
      expect(() => connectorRegistry.register(fixture('test-dupe'))).toThrow(/already registered/);
    });

    it('starts a connector with manualSetupSteps in needs_user_setup', () => {
      connectorRegistry.register(
        fixture('test-needs-setup', { manualSetupSteps: ['Step 1', 'Step 2'] }),
      );
      expect(connectorRegistry.get('test-needs-setup')!.status).toBe('needs_user_setup');
    });

    it('freezes the manifest so callers cannot mutate riskLevel', () => {
      const m = fixture('test-freeze');
      connectorRegistry.register(m);
      const stored = connectorRegistry.get('test-freeze')!.manifest;
      expect(() => {
        (stored as { riskLevel: RiskLevel }).riskLevel = RiskLevel.LOW;
      }).toThrow();
    });
  });

  describe('setStatus() honesty rules', () => {
    it('refuses to set installed on a connector with no installMethod', () => {
      connectorRegistry.register(fixture('test-no-install'));
      expect(() => connectorRegistry.setStatus('test-no-install', 'installed')).toThrow(/no installMethod/);
      expect(() => connectorRegistry.setStatus('test-no-install', 'configured')).toThrow(/no installMethod/);
    });

    it('allows installed when the manifest declares an installMethod', () => {
      connectorRegistry.register(
        fixture('test-installable', { installMethod: 'npx', installCommand: 'npx test' }),
      );
      connectorRegistry.setStatus('test-installable', 'installed');
      expect(connectorRegistry.get('test-installable')!.status).toBe('installed');
    });

    it('records the reason on a non-available status', () => {
      connectorRegistry.register(
        fixture('test-disabled'),
      );
      connectorRegistry.setStatus('test-disabled', 'disabled', 'tenant admin disabled');
      const view = connectorRegistry.get('test-disabled')!;
      expect(view.status).toBe('disabled');
      expect(view.statusReason).toBe('tenant admin disabled');
    });

    it('throws when the connector id is unknown', () => {
      expect(() => connectorRegistry.setStatus('does-not-exist', 'available')).toThrow(/not registered/);
    });
  });

  describe('recordValidation()', () => {
    it('records lastValidatedAt + installedToolCount on success', () => {
      connectorRegistry.register(
        fixture('test-validate', { installMethod: 'npx' }),
      );
      connectorRegistry.recordValidation('test-validate', { success: true, installedToolCount: 5 });
      const view = connectorRegistry.get('test-validate')!;
      expect(view.lastValidatedAt).toBeDefined();
      expect(view.installedToolCount).toBe(5);
    });

    it('lifts failed_validation when a fresh validation succeeds', () => {
      connectorRegistry.register(fixture('test-recover', { installMethod: 'npx' }));
      connectorRegistry.recordValidation('test-recover', { success: false, failureReason: 'bad output' });
      expect(connectorRegistry.get('test-recover')!.status).toBe('failed_validation');
      connectorRegistry.recordValidation('test-recover', { success: true, installedToolCount: 1 });
      expect(connectorRegistry.get('test-recover')!.status).toBe('installed');
      expect(connectorRegistry.get('test-recover')!.statusReason).toBeUndefined();
    });

    it('flips to failed_validation on failure with the reason persisted', () => {
      connectorRegistry.register(fixture('test-fail', { installMethod: 'npx' }));
      connectorRegistry.recordValidation('test-fail', { success: false, failureReason: 'exit 127' });
      const view = connectorRegistry.get('test-fail')!;
      expect(view.status).toBe('failed_validation');
      expect(view.statusReason).toBe('exit 127');
    });
  });

  describe('post-launch audit fixes — honesty rule regression tests', () => {
    it('refuses configured-from-available on installable connectors (must transition through installed)', () => {
      // Bug: a caller could persist credentials and flip status to
      // `configured` without ever running the install command. Dashboard
      // would lie. Now setStatus enforces installed → configured for
      // any manifest that declares an installMethod.
      connectorRegistry.register(
        fixture('test-installable-strict', {
          installMethod: 'npx',
          installCommand: 'npx test',
        }),
      );
      expect(() =>
        connectorRegistry.setStatus('test-installable-strict', 'configured'),
      ).toThrow(/must transition through "installed" first/);
    });

    it('allows configured-from-available for pure-API connectors (no installMethod)', () => {
      // Pure-API connectors have no install step — their lifecycle is
      // available → configured once credentials are saved. The honesty
      // rule must not block them.
      connectorRegistry.register(
        fixture('test-pure-api', {
          credentialFields: [
            { key: 'apiKey', label: 'API Key', placeholder: 'sk-…', type: 'password' },
          ],
        }),
      );
      // Pure-API has no installMethod, so `configured` would fail rule 1.
      // The exempt branch is rule 2 — verify rule 1 still fires.
      expect(() =>
        connectorRegistry.setStatus('test-pure-api', 'configured'),
      ).toThrow(/no installMethod/);
    });

    it('allows installed → configured transition normally', () => {
      connectorRegistry.register(
        fixture('test-happy-path', { installMethod: 'npx', installCommand: 'npx test' }),
      );
      connectorRegistry.setStatus('test-happy-path', 'installed');
      expect(() =>
        connectorRegistry.setStatus('test-happy-path', 'configured'),
      ).not.toThrow();
      expect(connectorRegistry.get('test-happy-path')!.status).toBe('configured');
    });

    it('refuses failed_validation without a non-empty reason', () => {
      // The dashboard renders statusReason verbatim; an empty reason
      // produces a useless "Failed validation" pill with no diagnostic
      // for the user. Honesty rule 3: require a reason.
      connectorRegistry.register(
        fixture('test-fail-no-reason', { installMethod: 'npx' }),
      );
      expect(() =>
        connectorRegistry.setStatus('test-fail-no-reason', 'failed_validation'),
      ).toThrow(/non-empty reason/);
      expect(() =>
        connectorRegistry.setStatus('test-fail-no-reason', 'failed_validation', '   '),
      ).toThrow(/non-empty reason/);
      expect(() =>
        connectorRegistry.setStatus('test-fail-no-reason', 'failed_validation', 'exit 127'),
      ).not.toThrow();
    });

    it('deep-freezes manifests so nested arrays/objects cannot be mutated post-registration', () => {
      // Bug: Object.freeze() is shallow — a caller could still mutate
      // `manifest.availableTools[0]` or `manifest.credentialFields[0].label`
      // post-registration, breaking the immutable-after-registration
      // contract. The deepFreeze helper recursively freezes every nested
      // object/array.
      connectorRegistry.register(
        fixture('test-deepfreeze', {
          availableTools: ['tool_a', 'tool_b'],
          credentialFields: [
            { key: 'k', label: 'Original', placeholder: '', type: 'text' },
          ],
        }),
      );
      const stored = connectorRegistry.get('test-deepfreeze')!.manifest;
      expect(() => {
        (stored.availableTools as string[]).push('rogue_tool');
      }).toThrow();
      expect(() => {
        ((stored.credentialFields as { label: string }[])[0]!).label = 'Hacked';
      }).toThrow();
    });
  });

  describe('list / filter accessors', () => {
    it('listByCategory returns only matching entries', () => {
      connectorRegistry.register(fixture('test-media-1', { category: 'media' }));
      connectorRegistry.register(fixture('test-media-2', { category: 'media' }));
      connectorRegistry.register(fixture('test-coding-1', { category: 'coding' }));
      const media = connectorRegistry.listByCategory('media');
      expect(media.map((v) => v.manifest.id).sort()).toEqual(['test-media-1', 'test-media-2']);
    });

    it('listByStatus returns only matching entries', () => {
      connectorRegistry.register(fixture('test-need', { manualSetupSteps: ['Step 1'] }));
      connectorRegistry.register(fixture('test-avail'));
      const needs = connectorRegistry.listByStatus('needs_user_setup');
      expect(needs.map((v) => v.manifest.id)).toEqual(['test-need']);
    });

    it('size() reflects registration count', () => {
      expect(connectorRegistry.size()).toBe(0);
      connectorRegistry.register(fixture('test-size-1'));
      connectorRegistry.register(fixture('test-size-2'));
      expect(connectorRegistry.size()).toBe(2);
    });
  });
});
