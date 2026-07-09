/**
 * shield-mcp-client.test.ts — HyperAgent Phase 8 Shield MCP client.
 *
 * Pins the client invariants:
 *   - LOCAL embedded mode: requests a signed decision via the injected verdict
 *     policy, the decision verifies under the public key, and the agent cannot
 *     choose the verdict (the policy decides);
 *   - REMOTE transport mode: a genuine response verifies; a tampered/forged
 *     response is rejected with ShieldDecisionUnverifiableError (the agent holds
 *     only the public key);
 *   - replay re-surfaces the verdict; expiry invalidates; the TTL sets expiresAt;
 *   - misconfiguration (no transport AND no signingKey; signingKey without
 *     verdictFor) throws ShieldMcpConfigError at construction.
 */
import { describe, it, expect } from 'vitest';
import {
  ShieldMcpClient,
  ShieldDecisionUnverifiableError,
  ShieldMcpConfigError,
} from '../../../packages/security/src/shield-gateway/shield-mcp-client.js';
import type { ShieldMcpTransport } from '../../../packages/security/src/shield-gateway/shield-mcp-client.js';
import {
  ShieldDecisionVerdict,
  generateShieldKeyPair,
  signDecision,
  verifyDecision,
} from '../../../packages/security/src/shield-gateway/signed-decision.js';
import type {
  ShieldDecisionSubject,
  ShieldSignedDecision,
  UnsignedShieldDecision,
} from '../../../packages/security/src/shield-gateway/signed-decision.js';

const NOW = Date.parse('2026-07-08T12:00:00Z');

function subject(over: Partial<ShieldDecisionSubject> = {}): ShieldDecisionSubject {
  return {
    kind: 'tool_call',
    tenantId: 'tenant-1',
    workflowId: 'wf-1',
    runId: 'run-1',
    requestHash: 'h1',
    ...over,
  };
}

describe('ShieldMcpClient — construction guards', () => {
  const { publicKeyPem, privateKeyPem } = generateShieldKeyPair();

  it('throws when neither a transport nor a signingKey is supplied', () => {
    expect(
      () => new ShieldMcpClient({ shieldId: 's', verificationKey: publicKeyPem }),
    ).toThrow(ShieldMcpConfigError);
  });

  it('throws when a signingKey is supplied without a verdictFor policy', () => {
    expect(
      () => new ShieldMcpClient({ shieldId: 's', verificationKey: publicKeyPem, signingKey: privateKeyPem }),
    ).toThrow(ShieldMcpConfigError);
  });
});

describe('ShieldMcpClient — LOCAL embedded mode', () => {
  const { publicKeyPem, privateKeyPem } = generateShieldKeyPair();

  it('requests a signed decision that verifies under the public key', async () => {
    const client = new ShieldMcpClient({
      shieldId: 'shield-local',
      verificationKey: publicKeyPem,
      signingKey: privateKeyPem,
      verdictFor: () => ShieldDecisionVerdict.ALLOW,
    });
    const d = await client.requestDecision(subject(), NOW);
    expect(d.verdict).toBe(ShieldDecisionVerdict.ALLOW);
    expect(d.shieldId).toBe('shield-local');
    expect(d.decisionId).toHaveLength(32);
    expect(client.verify(d, NOW).valid).toBe(true);
  });

  it('the verdict is chosen by the policy, NOT by the caller', async () => {
    const client = new ShieldMcpClient({
      shieldId: 'shield-local',
      verificationKey: publicKeyPem,
      signingKey: privateKeyPem,
      verdictFor: () => ShieldDecisionVerdict.APPROVE_REQUIRED,
    });
    // The caller passes a subject; it has NO way to request ALLOW.
    const d = await client.requestDecision(subject(), NOW);
    expect(d.verdict).toBe(ShieldDecisionVerdict.APPROVE_REQUIRED);
  });

  it('sets expiresAt = issuedAt + ttlMs', async () => {
    const client = new ShieldMcpClient({
      shieldId: 'shield-local',
      verificationKey: publicKeyPem,
      signingKey: privateKeyPem,
      ttlMs: 60_000,
      verdictFor: () => ShieldDecisionVerdict.ALLOW,
    });
    const d = await client.requestDecision(subject(), NOW);
    expect(Date.parse(d.expiresAt) - Date.parse(d.issuedAt)).toBe(60_000);
  });

  it('replays the recorded verdict and invalidates after expiry', async () => {
    const client = new ShieldMcpClient({
      shieldId: 'shield-local',
      verificationKey: publicKeyPem,
      signingKey: privateKeyPem,
      ttlMs: 60_000,
      verdictFor: () => ShieldDecisionVerdict.ALLOW,
    });
    const d = await client.requestDecision(subject(), NOW);
    expect(client.replay(d, NOW).valid).toBe(true);
    const afterExpiry = NOW + 61_000;
    expect(client.replay(d, afterExpiry).valid).toBe(false);
  });

  it('determinism: same subject + now ⇒ identical signed decision', async () => {
    const client = new ShieldMcpClient({
      shieldId: 'shield-local',
      verificationKey: publicKeyPem,
      signingKey: privateKeyPem,
      verdictFor: () => ShieldDecisionVerdict.ALLOW,
    });
    const a = await client.requestDecision(subject(), NOW);
    const b = await client.requestDecision(subject(), NOW);
    expect(a).toEqual(b);
  });
});

describe('ShieldMcpClient — REMOTE transport mode', () => {
  const shieldKeys = generateShieldKeyPair();
  const attackerKeys = generateShieldKeyPair();

  function makeTransport(signingKey: string, verdict: ShieldDecisionVerdict): ShieldMcpTransport {
    return {
      async requestSignedDecision(subj, issuedAt): Promise<ShieldSignedDecision> {
        const unsig: UnsignedShieldDecision = {
          verdict,
          subject: subj,
          shieldId: 'shield-remote',
          issuedAt,
          expiresAt: new Date(Date.parse(issuedAt) + 5 * 60 * 1000).toISOString(),
        };
        return signDecision(unsig, signingKey);
      },
    };
  }

  it('accepts a genuine decision from the Shield transport', async () => {
    const client = new ShieldMcpClient({
      shieldId: 'shield-remote',
      verificationKey: shieldKeys.publicKeyPem,
      transport: makeTransport(shieldKeys.privateKeyPem, ShieldDecisionVerdict.ALLOW),
    });
    const d = await client.requestDecision(subject(), NOW);
    expect(d.verdict).toBe(ShieldDecisionVerdict.ALLOW);
    expect(client.verify(d, NOW).valid).toBe(true);
  });

  it('rejects a decision signed by a DIFFERENT (attacker) key', async () => {
    const client = new ShieldMcpClient({
      shieldId: 'shield-remote',
      verificationKey: shieldKeys.publicKeyPem,
      transport: makeTransport(attackerKeys.privateKeyPem, ShieldDecisionVerdict.ALLOW),
    });
    await expect(client.requestDecision(subject(), NOW)).rejects.toBeInstanceOf(ShieldDecisionUnverifiableError);
  });

  it('rejects a tampered decision (verdict flipped in transit)', async () => {
    const transport: ShieldMcpTransport = {
      async requestSignedDecision(subj, issuedAt): Promise<ShieldSignedDecision> {
        const genuine = signDecision(
          {
            verdict: ShieldDecisionVerdict.ALLOW,
            subject: subj,
            shieldId: 'shield-remote',
            issuedAt,
            expiresAt: new Date(Date.parse(issuedAt) + 5 * 60 * 1000).toISOString(),
          },
          shieldKeys.privateKeyPem,
        );
        // Man-in-the-middle flips the verdict but keeps the stale signature.
        return { ...genuine, verdict: ShieldDecisionVerdict.BLOCK };
      },
    };
    const client = new ShieldMcpClient({
      shieldId: 'shield-remote',
      verificationKey: shieldKeys.publicKeyPem,
      transport,
    });
    await expect(client.requestDecision(subject(), NOW)).rejects.toBeInstanceOf(ShieldDecisionUnverifiableError);
  });

  it('rejects an expired decision returned by the transport', async () => {
    const transport: ShieldMcpTransport = {
      async requestSignedDecision(subj, issuedAt): Promise<ShieldSignedDecision> {
        // Transport hands back a decision already past its expiry.
        const expired = new Date(Date.parse(issuedAt) - 1000).toISOString();
        return signDecision(
          {
            verdict: ShieldDecisionVerdict.ALLOW,
            subject: subj,
            shieldId: 'shield-remote',
            issuedAt,
            expiresAt: expired,
          },
          shieldKeys.privateKeyPem,
        );
      },
    };
    const client = new ShieldMcpClient({
      shieldId: 'shield-remote',
      verificationKey: shieldKeys.publicKeyPem,
      transport,
    });
    await expect(client.requestDecision(subject(), NOW)).rejects.toBeInstanceOf(ShieldDecisionUnverifiableError);
  });

  it('REJECTS a validly-signed decision for a DIFFERENT subject (substitution defense — Bug 2)', async () => {
    // The transport returns a decision that is genuinely signed by the Shield
    // and internally consistent — but it is for a DIFFERENT subject (a
    // previously-ALLOWed low-risk tool call, not the high-risk one we asked
    // about). Before the fix, verifyDecision passed and the client returned
    // the substituted decision, authorising the wrong action. The fix binds the
    // returned decision to the requested subject and rejects on mismatch.
    const lowRiskSubject = subject({ requestHash: 'low-risk-hash', runId: 'run-low' });
    const transport: ShieldMcpTransport = {
      async requestSignedDecision(_subj, issuedAt): Promise<ShieldSignedDecision> {
        // Ignore the requested subject; hand back a validly-signed decision for
        // the low-risk subject instead.
        return signDecision(
          {
            verdict: ShieldDecisionVerdict.ALLOW,
            subject: lowRiskSubject,
            shieldId: 'shield-remote',
            issuedAt,
            expiresAt: new Date(Date.parse(issuedAt) + 5 * 60 * 1000).toISOString(),
          },
          shieldKeys.privateKeyPem,
        );
      },
    };
    const client = new ShieldMcpClient({
      shieldId: 'shield-remote',
      verificationKey: shieldKeys.publicKeyPem,
      transport,
    });
    const requestedHighRisk = subject({ requestHash: 'high-risk-hash', runId: 'run-high' });
    await expect(client.requestDecision(requestedHighRisk, NOW)).rejects.toThrow(
      /substitution/,
    );
  });

  it('accepts a decision whose subject matches exactly (requestHash + context)', async () => {
    // Regression guard: the binding check must not reject a genuine, matching
    // decision. Same subject object ⇒ same canonical string ⇒ accepted.
    const client = new ShieldMcpClient({
      shieldId: 'shield-remote',
      verificationKey: shieldKeys.publicKeyPem,
      transport: makeTransport(shieldKeys.privateKeyPem, ShieldDecisionVerdict.ALLOW),
    });
    const s = subject({ requestHash: 'exact-hash', runId: 'run-x' });
    const d = await client.requestDecision(s, NOW);
    expect(d.verdict).toBe(ShieldDecisionVerdict.ALLOW);
    expect(d.subject.requestHash).toBe('exact-hash');
  });
});

describe('ShieldMcpClient — public-key-only property', () => {
  it('the agent (public key only) cannot produce a decision that verifies', () => {
    const { publicKeyPem, privateKeyPem } = generateShieldKeyPair();
    // Agent constructs a client with ONLY the public key (no signingKey).
    // It cannot sign; the only way to get a decision is via a transport the
    // Shield controls. A decision forged with the wrong key fails verification.
    const forged = signDecision(
      {
        verdict: ShieldDecisionVerdict.ALLOW,
        subject: subject(),
        shieldId: 'shield-remote',
        issuedAt: new Date(NOW).toISOString(),
        expiresAt: new Date(NOW + 60_000).toISOString(),
      },
      generateShieldKeyPair().privateKeyPem, // some other key
    );
    expect(verifyDecision(forged, publicKeyPem, NOW).valid).toBe(false);
    // Sanity: the genuine key DOES verify.
    const genuine = signDecision(
      {
        verdict: ShieldDecisionVerdict.ALLOW,
        subject: subject(),
        shieldId: 'shield-remote',
        issuedAt: new Date(NOW).toISOString(),
        expiresAt: new Date(NOW + 60_000).toISOString(),
      },
      privateKeyPem,
    );
    expect(verifyDecision(genuine, publicKeyPem, NOW).valid).toBe(true);
  });
});