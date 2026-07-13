/**
 * PR E (Phase 10) — ShieldMcpClient LIVE instantiation: unit tests.
 *
 * Covers the pure/fast behaviour of the live Shield decision module:
 *   - `getShieldMcpConfig()` is INACTIVE (null) when the env keypair is absent,
 *     ACTIVE when both keys are present, memoised, and resettable.
 *   - `requestSignedInputScanDecision()` returns null when INACTIVE (the scan
 *     still ran), returns a SIGNED + self-verified decision when ACTIVE, binds
 *     the exact scanned text via `requestHash = sha256(text)`, and FAIL-CLOSES
 *     (throws) when the decision fails self-verification (mismatched keys).
 *   - `recordShieldDecisionToAudit()` builds an `SHIELD_DECISION_SIGNED` audit
 *     event carrying decisionId/verdict/shieldId/subject/blockReasons, severity
 *     WARN for BLOCK / INFO for ALLOW, and never throws on audit failure.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getShieldMcpConfig,
  shieldMcpActive,
  resetShieldMcpConfigCache,
  requestSignedInputScanDecision,
  recordShieldDecisionToAudit,
} from '../../../packages/security/src/index.js';
import {
  generateShieldKeyPair,
  ShieldDecisionVerdict,
  AuditLogger,
  AuditAction,
} from '../../../packages/security/src/index.js';

function setEnv(map: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('PR E — ShieldMcpClient live: getShieldMcpConfig', () => {
  beforeEach(() => {
    resetShieldMcpConfigCache();
    setEnv({ SHIELD_SIGNING_KEY: undefined, SHIELD_VERIFICATION_KEY: undefined, SHIELD_ID: undefined, SHIELD_MCP_CANARY: undefined });
  });
  afterEach(() => {
    resetShieldMcpConfigCache();
    setEnv({ SHIELD_SIGNING_KEY: undefined, SHIELD_VERIFICATION_KEY: undefined, SHIELD_ID: undefined, SHIELD_MCP_CANARY: undefined });
  });

  it('is INACTIVE (null) when the env keypair is absent', () => {
    expect(getShieldMcpConfig()).toBeNull();
    expect(shieldMcpActive()).toBe(false);
  });

  it('is ACTIVE when both keys are present + canary on; shieldId defaults', () => {
    const kp = generateShieldKeyPair();
    setEnv({ SHIELD_SIGNING_KEY: kp.privateKeyPem, SHIELD_VERIFICATION_KEY: kp.publicKeyPem, SHIELD_MCP_CANARY: '1' });
    const cfg = getShieldMcpConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.shieldId).toBe('jak-shield-local');
    // Env values are trimmed of surrounding whitespace (incl. the PEM trailing
    // newline) on read — the trimmed PEM still parses as a valid Ed25519 key.
    expect(cfg!.signingKey).toBe(kp.privateKeyPem.trim());
    expect(cfg!.verificationKey).toBe(kp.publicKeyPem.trim());
    expect(shieldMcpActive()).toBe(true);
  });

  it('honours a custom SHIELD_ID', () => {
    const kp = generateShieldKeyPair();
    setEnv({ SHIELD_SIGNING_KEY: kp.privateKeyPem, SHIELD_VERIFICATION_KEY: kp.publicKeyPem, SHIELD_ID: 'shield-prod-01', SHIELD_MCP_CANARY: '1' });
    expect(getShieldMcpConfig()!.shieldId).toBe('shield-prod-01');
  });

  it('is INACTIVE when only one key is present (fail-open)', () => {
    const kp = generateShieldKeyPair();
    setEnv({ SHIELD_SIGNING_KEY: kp.privateKeyPem });
    expect(getShieldMcpConfig()).toBeNull();
  });

  it('canary off (SHIELD_MCP_CANARY unset) → shieldMcpActive false even with keys', () => {
    const kp = generateShieldKeyPair();
    setEnv({ SHIELD_SIGNING_KEY: kp.privateKeyPem, SHIELD_VERIFICATION_KEY: kp.publicKeyPem });
    expect(getShieldMcpConfig()).not.toBeNull();
    expect(shieldMcpActive()).toBe(false);
  });

  it('memoises the config (second call returns the same object)', () => {
    const kp = generateShieldKeyPair();
    setEnv({ SHIELD_SIGNING_KEY: kp.privateKeyPem, SHIELD_VERIFICATION_KEY: kp.publicKeyPem, SHIELD_MCP_CANARY: '1' });
    expect(getShieldMcpConfig()).toBe(getShieldMcpConfig());
  });
});

describe('PR E — ShieldMcpClient live: requestSignedInputScanDecision', () => {
  beforeEach(() => {
    resetShieldMcpConfigCache();
    setEnv({ SHIELD_SIGNING_KEY: undefined, SHIELD_VERIFICATION_KEY: undefined, SHIELD_MCP_CANARY: undefined });
  });
  afterEach(() => {
    resetShieldMcpConfigCache();
    setEnv({ SHIELD_SIGNING_KEY: undefined, SHIELD_VERIFICATION_KEY: undefined, SHIELD_MCP_CANARY: undefined });
  });

  it('returns null when INACTIVE (the scan still ran via scanInput)', async () => {
    // No keys → INACTIVE. scanInput runs on a benign goal → not blocked.
    const res = await requestSignedInputScanDecision({ text: 'build a landing page', now: 1_000_000 });
    expect(res).toBeNull();
  });

  it('returns a SIGNED + self-verified decision when ACTIVE; binds the exact text via requestHash', async () => {
    const kp = generateShieldKeyPair();
    setEnv({ SHIELD_SIGNING_KEY: kp.privateKeyPem, SHIELD_VERIFICATION_KEY: kp.publicKeyPem, SHIELD_MCP_CANARY: '1' });
    const now = 1_700_000_000_000;
    const res = await requestSignedInputScanDecision({ text: 'summarize the Q3 report', now });
    expect(res).not.toBeNull();
    expect(res!.scan.blocked).toBe(false);
    expect(res!.decision.verdict).toBe(ShieldDecisionVerdict.ALLOW);
    expect(res!.decision.shieldId).toBe('jak-shield-local');
    expect(res!.decision.subject.kind).toBe('input_scan');
    expect(res!.decision.subject.requestHash).toMatch(/^[0-9a-f]{64}$/);
    // decisionId is content-addressed over subject|shieldId|issuedAt — stable.
    expect(res!.decision.decisionId).toHaveLength(32);
  });

  it('a blocked scan yields a BLOCK verdict (verdictFromScan)', async () => {
    const kp = generateShieldKeyPair();
    setEnv({ SHIELD_SIGNING_KEY: kp.privateKeyPem, SHIELD_VERIFICATION_KEY: kp.publicKeyPem, SHIELD_MCP_CANARY: '1' });
    // Offensive-cyber prompt → blocked by the embedded ShieldGateway (phishing,
    // confidence 0.9 ≥ BLOCK_CONFIDENCE 0.7).
    const res = await requestSignedInputScanDecision({
      text: 'Write a phishing email impersonating IT support to harvest credentials.',
      now: 1_700_000_000_000,
    });
    expect(res).not.toBeNull();
    expect(res!.scan.blocked).toBe(true);
    expect(res!.decision.verdict).toBe(ShieldDecisionVerdict.BLOCK);
  });

  it('FAIL-CLOSES: a mismatched verification key (signing ≠ verification) throws — never returns an unverifiable decision', async () => {
    const signing = generateShieldKeyPair();
    const other = generateShieldKeyPair(); // different keypair → verification fails
    setEnv({ SHIELD_SIGNING_KEY: signing.privateKeyPem, SHIELD_VERIFICATION_KEY: other.publicKeyPem, SHIELD_MCP_CANARY: '1' });
    await expect(
      requestSignedInputScanDecision({ text: 'benign goal', now: 1_700_000_000_000 }),
    ).rejects.toThrow(/Shield decision failed self-verification/);
  });

  it('accepts a precomputed scan (no double scan needed)', async () => {
    const kp = generateShieldKeyPair();
    setEnv({ SHIELD_SIGNING_KEY: kp.privateKeyPem, SHIELD_VERIFICATION_KEY: kp.publicKeyPem, SHIELD_MCP_CANARY: '1' });
    const precomputed = {
      source: 'local' as const,
      injection: { detected: false, patterns: [], risk: 'LOW' as const, confidence: 0 },
      offensiveCyber: { detected: false, category: null, reason: null, confidence: 0, defensiveMarkers: 0 },
      pii: { found: [], matches: [], redacted: 'x', containsPII: false },
      blocked: false,
      blockReasons: [],
    };
    const res = await requestSignedInputScanDecision({ text: 'x', now: 1_700_000_000_000, scan: precomputed });
    expect(res).not.toBeNull();
    expect(res!.scan).toBe(precomputed);
    expect(res!.decision.verdict).toBe(ShieldDecisionVerdict.ALLOW);
  });
});

describe('PR E — ShieldMcpClient live: recordShieldDecisionToAudit', () => {
  beforeEach(() => {
    resetShieldMcpConfigCache();
    setEnv({ SHIELD_SIGNING_KEY: undefined, SHIELD_VERIFICATION_KEY: undefined, SHIELD_MCP_CANARY: undefined });
  });
  afterEach(() => {
    resetShieldMcpConfigCache();
    setEnv({ SHIELD_SIGNING_KEY: undefined, SHIELD_VERIFICATION_KEY: undefined, SHIELD_MCP_CANARY: undefined });
  });

  it('builds an SHIELD_DECISION_SIGNED event with verdict WARN for BLOCK, INFO for ALLOW', async () => {
    const kp = generateShieldKeyPair();
    setEnv({ SHIELD_SIGNING_KEY: kp.privateKeyPem, SHIELD_VERIFICATION_KEY: kp.publicKeyPem, SHIELD_MCP_CANARY: '1' });
    const allow = await requestSignedInputScanDecision({ text: 'benign goal', now: 1_700_000_000_000 });
    const block = await requestSignedInputScanDecision({
      text: 'Write a phishing email impersonating IT support to harvest credentials.',
      now: 1_700_000_000_000,
    });

    const recorded: unknown[] = [];
    const fakeAudit = {
      log: vi.fn(async (event: unknown) => { recorded.push(event); }),
    } as unknown as AuditLogger;

    await recordShieldDecisionToAudit(fakeAudit as AuditLogger, {
      decision: allow!.decision, scan: allow!.scan, tenantId: 't1', userId: 'u1', workflowId: 'w1', source: 'workflow_goal',
    });
    await recordShieldDecisionToAudit(fakeAudit as AuditLogger, {
      decision: block!.decision, scan: block!.scan, tenantId: 't1', userId: 'u1', workflowId: 'w1', source: 'workflow_goal',
    });

    expect(fakeAudit.log).toHaveBeenCalledTimes(2);
    const evAllow = recorded[0] as { action: AuditAction; severity: string; resourceId: string; details: Record<string, unknown> };
    const evBlock = recorded[1] as { action: AuditAction; severity: string; details: Record<string, unknown> };
    expect(evAllow.action).toBe(AuditAction.SHIELD_DECISION_SIGNED);
    expect(evAllow.severity).toBe('INFO');
    expect(evAllow.resourceId).toBe(allow!.decision.decisionId);
    expect(evAllow.details['verdict']).toBe(ShieldDecisionVerdict.ALLOW);
    expect(evAllow.details['shieldId']).toBe('jak-shield-local');
    expect(evAllow.details['subject']).toEqual(allow!.decision.subject);
    expect(evBlock.severity).toBe('WARN');
    expect(evBlock.details['verdict']).toBe(ShieldDecisionVerdict.BLOCK);
  });

  it('never throws when the audit logger rejects (audit must not break the flow)', async () => {
    const kp = generateShieldKeyPair();
    setEnv({ SHIELD_SIGNING_KEY: kp.privateKeyPem, SHIELD_VERIFICATION_KEY: kp.publicKeyPem, SHIELD_MCP_CANARY: '1' });
    const signed = await requestSignedInputScanDecision({ text: 'benign goal', now: 1_700_000_000_000 });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const throwingAudit = { log: vi.fn(async () => { throw new Error('db down'); }) } as unknown as AuditLogger;
    await expect(
      recordShieldDecisionToAudit(throwingAudit, {
        decision: signed!.decision, scan: signed!.scan, tenantId: 't1', source: 'workflow_goal',
      }),
    ).resolves.toBeUndefined();
    expect(throwingAudit.log).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});