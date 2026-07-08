/**
 * signed-decision.test.ts — HyperAgent Phase 8 pure crypto core.
 *
 * Pins the signed-decision invariants:
 *   - decisionId is content-addressed (same subject+shieldId+issuedAt ⇒ same id);
 *   - signDecision is deterministic (Ed25519 deterministic nonce);
 *   - verifyDecision accepts a genuine signature and rejects tamper of EVERY
 *     signed field (verdict, subject, shieldId, issuedAt, expiresAt, signature)
 *     plus expiry + decisionId-substitution;
 *   - replayDecision re-surfaces the recorded verdict with validity;
 *   - the verdict adapters map ShieldGateway outputs correctly.
 */
import { describe, it, expect } from 'vitest';
import {
  ShieldDecisionVerdict,
  canonicalizeSubject,
  decisionIdFor,
  decisionPayload,
  generateShieldKeyPair,
  signDecision,
  verifyDecision,
  isExpired,
  replayDecision,
  verdictFromToolEvaluation,
  verdictFromScan,
} from '../../../packages/security/src/shield-gateway/signed-decision.js';
import type {
  ShieldDecisionSubject,
  UnsignedShieldDecision,
} from '../../../packages/security/src/shield-gateway/signed-decision.js';
import type {
  ShieldToolCallEvaluation,
  ShieldInputScanResult,
} from '../../../packages/security/src/shield-gateway/types.js';

const NOW = Date.parse('2026-07-08T12:00:00Z');
const ISSUED = '2026-07-08T12:00:00.000Z';
const EXPIRES = '2026-07-08T12:05:00.000Z';

function subject(over: Partial<ShieldDecisionSubject> = {}): ShieldDecisionSubject {
  return {
    kind: 'tool_call',
    tenantId: 'tenant-1',
    workflowId: 'wf-1',
    runId: 'run-1',
    requestHash: 'abc123',
    ...over,
  };
}

function unsig(over: Partial<UnsignedShieldDecision> = {}): UnsignedShieldDecision {
  return {
    verdict: ShieldDecisionVerdict.ALLOW,
    subject: subject(),
    shieldId: 'shield-prod',
    issuedAt: ISSUED,
    expiresAt: EXPIRES,
    ...over,
  };
}

describe('canonicalizeSubject + decisionIdFor', () => {
  it('canonicalises the subject in a stable, key-order-independent way', () => {
    expect(canonicalizeSubject(subject())).toBe('tool_call|tenant-1|wf-1|run-1|abc123');
  });

  it('produces a content-addressed decisionId (deterministic)', () => {
    const id1 = decisionIdFor(subject(), 'shield-prod', ISSUED);
    const id2 = decisionIdFor(subject(), 'shield-prod', ISSUED);
    expect(id1).toBe(id2);
    expect(id1).toHaveLength(32);
    expect(id1).toMatch(/^[0-9a-f]{32}$/);
  });

  it('changes the id when the subject, shieldId or issuedAt changes', () => {
    const base = decisionIdFor(subject(), 'shield-prod', ISSUED);
    expect(decisionIdFor(subject({ requestHash: 'zzz' }), 'shield-prod', ISSUED)).not.toBe(base);
    expect(decisionIdFor(subject(), 'shield-other', ISSUED)).not.toBe(base);
    expect(decisionIdFor(subject(), 'shield-prod', '2026-07-08T12:00:01.000Z')).not.toBe(base);
  });
});

describe('signDecision + verifyDecision — happy path', () => {
  const { privateKeyPem, publicKeyPem } = generateShieldKeyPair();

  it('signs deterministically (same key + inputs ⇒ same signature)', () => {
    const a = signDecision(unsig(), privateKeyPem);
    const b = signDecision(unsig(), privateKeyPem);
    expect(a.signature).toBe(b.signature);
    expect(a.decisionId).toBe(decisionIdFor(subject(), 'shield-prod', ISSUED));
  });

  it('verifies a genuine, unexpired decision', () => {
    const d = signDecision(unsig(), privateKeyPem);
    const v = verifyDecision(d, publicKeyPem, NOW);
    expect(v.valid).toBe(true);
    expect(v.reason).toBe('ok');
  });

  it('the decisionId in the signed decision matches the recomputed id', () => {
    const d = signDecision(unsig(), privateKeyPem);
    expect(d.decisionId).toBe(decisionIdFor(subject(), 'shield-prod', ISSUED));
  });
});

describe('verifyDecision — tamper rejection', () => {
  const { privateKeyPem, publicKeyPem } = generateShieldKeyPair();

  it('rejects a verdict change', () => {
    const d = signDecision(unsig(), privateKeyPem);
    const tampered = { ...d, verdict: ShieldDecisionVerdict.BLOCK };
    expect(verifyDecision(tampered, publicKeyPem, NOW).valid).toBe(false);
  });

  it('rejects a subject (requestHash) change', () => {
    const d = signDecision(unsig(), privateKeyPem);
    const tampered = { ...d, subject: subject({ requestHash: 'swapped' }) };
    const v = verifyDecision(tampered, publicKeyPem, NOW);
    expect(v.valid).toBe(false);
    // decisionId recomputed from the swapped subject no longer matches d.decisionId.
    expect(v.reason).toMatch(/decisionId mismatch/);
  });

  it('rejects a shieldId change', () => {
    const d = signDecision(unsig(), privateKeyPem);
    const tampered = { ...d, shieldId: 'shield-evil' };
    expect(verifyDecision(tampered, publicKeyPem, NOW).valid).toBe(false);
  });

  it('rejects an issuedAt change (id-bound field)', () => {
    const d = signDecision(unsig(), privateKeyPem);
    const tampered = { ...d, issuedAt: '2026-07-08T11:59:59.000Z' };
    expect(verifyDecision(tampered, publicKeyPem, NOW).valid).toBe(false);
  });

  it('rejects a signature change', () => {
    const d = signDecision(unsig(), privateKeyPem);
    const flipped = d.signature.endsWith('0')
      ? d.signature.slice(0, -1) + '1'
      : d.signature.slice(0, -1) + '0';
    expect(verifyDecision({ ...d, signature: flipped }, publicKeyPem, NOW).valid).toBe(false);
  });

  it('rejects a signature from a DIFFERENT key', () => {
    const d = signDecision(unsig(), privateKeyPem);
    const other = generateShieldKeyPair();
    expect(verifyDecision(d, other.publicKeyPem, NOW).valid).toBe(false);
  });
});

describe('verifyDecision — expiry', () => {
  const { privateKeyPem, publicKeyPem } = generateShieldKeyPair();

  it('is valid just before expiry', () => {
    const d = signDecision(unsig(), privateKeyPem);
    expect(verifyDecision(d, publicKeyPem, Date.parse('2026-07-08T12:04:59.999Z')).valid).toBe(true);
  });

  it('is invalid at/after expiry', () => {
    const d = signDecision(unsig(), privateKeyPem);
    expect(isExpired(d, NOW)).toBe(false);
    expect(isExpired(d, Date.parse(EXPIRES))).toBe(true);
    const v = verifyDecision(d, publicKeyPem, Date.parse(EXPIRES));
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/expired/);
  });
});

describe('replayDecision — audit seam', () => {
  const { privateKeyPem, publicKeyPem } = generateShieldKeyPair();

  it('re-surfaces the recorded verdict when the decision still verifies', () => {
    const d = signDecision(unsig({ verdict: ShieldDecisionVerdict.APPROVE_REQUIRED }), privateKeyPem);
    const r = replayDecision(d, publicKeyPem, NOW);
    expect(r.valid).toBe(true);
    expect(r.verdict).toBe(ShieldDecisionVerdict.APPROVE_REQUIRED);
  });

  it('reports invalid + the recorded verdict when the decision no longer verifies', () => {
    const d = signDecision(unsig(), privateKeyPem);
    const tampered = { ...d, verdict: ShieldDecisionVerdict.BLOCK };
    const r = replayDecision(tampered, publicKeyPem, NOW);
    expect(r.valid).toBe(false);
    // The recorded (tampered) verdict is surfaced, but validity flags it as untrusted.
    expect(r.verdict).toBe(ShieldDecisionVerdict.BLOCK);
  });
});

describe('verdict adapters', () => {
  it('maps a tool evaluation requiring approval to APPROVE_REQUIRED, else ALLOW', () => {
    const gated: ShieldToolCallEvaluation = {
      source: 'local',
      toolName: 'send_webhook',
      riskClass: 'EXTERNAL_SIDE_EFFECT' as never,
      requiresApproval: true,
      reason: 'gated',
    };
    const open: ShieldToolCallEvaluation = { ...gated, toolName: 'web_search', requiresApproval: false };
    expect(verdictFromToolEvaluation(gated)).toBe(ShieldDecisionVerdict.APPROVE_REQUIRED);
    expect(verdictFromToolEvaluation(open)).toBe(ShieldDecisionVerdict.ALLOW);
  });

  it('maps a blocked scan to BLOCK, else ALLOW', () => {
    const blocked = { source: 'local', blocked: true, blockReasons: [{ code: 'prompt_injection', message: 'x', confidence: 0.9 }] } as unknown as ShieldInputScanResult;
    const clean = { source: 'local', blocked: false, blockReasons: [] } as unknown as ShieldInputScanResult;
    expect(verdictFromScan(blocked)).toBe(ShieldDecisionVerdict.BLOCK);
    expect(verdictFromScan(clean)).toBe(ShieldDecisionVerdict.ALLOW);
  });
});

describe('decisionPayload — stability', () => {
  it('includes every signed field in a fixed order', () => {
    const u = unsig();
    const id = decisionIdFor(u.subject, u.shieldId, u.issuedAt);
    expect(decisionPayload({ ...u, decisionId: id })).toBe(
      `${id}|ALLOW|tool_call|tenant-1|wf-1|run-1|abc123|shield-prod|${ISSUED}|${EXPIRES}`,
    );
  });
});