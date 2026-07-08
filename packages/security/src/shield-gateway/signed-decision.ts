/**
 * signed-decision.ts — HyperAgent Phase 8: cryptographically-signed Shield decisions.
 *
 * Every autonomous HyperAgent decision (run a tool, promote a learning, apply a
 * revised plan) must be COUNTERSIGNED by JAK Shield before it may act. A signed
 * decision carries:
 *
 *   - a stable `decisionId` (content-addressed — sha256 of the canonical subject,
 *     shield id and issue time) so the same decision is replayable by id;
 *   - a `verdict` (ALLOW / BLOCK / APPROVE_REQUIRED) chosen by the Shield's own
 *     policy — NEVER by the agent — so the agent cannot self-authorise;
 *   - an Ed25519 `signature` over the full decision payload; the agent holds only
 *     the Shield's PUBLIC key and therefore CANNOT forge or alter a decision;
 *   - `issuedAt` / `expiresAt` so a leaked decision cannot be replayed forever.
 *
 * `verifyDecision` recomputes the signature with the public key, checks the
 * decision-id against the recomputed id (detects field tampering) and checks
 * expiry. `replayDecision` is the audit seam: given a stored decision it re-verifies
 * and re-surfaces the verdict, so an auditor can replay the exact decision the
 * Shield made at decision-time, long after the run.
 *
 * Pure + deterministic (Ed25519 uses a deterministic nonce per RFC 8032): the same
 * key + subject + issue time ⇒ the same signature. No I/O, no Date.now — the caller
 * stamps `issuedAt` and `now`. The LLM may PROPOSE actions; only the Shield SIGNS,
 * and only a verified, unexpired signature authorises the agent to act.
 */
import {
  sign as edSign,
  verify as edVerify,
  createHash,
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  timingSafeEqual,
} from 'node:crypto';
import type { KeyObject } from 'node:crypto';

/** The three verdicts the Shield may return for an autonomous action. */
export enum ShieldDecisionVerdict {
  /** The Shield permits the action unconditionally. */
  ALLOW = 'ALLOW',
  /** The Shield forbids the action outright (blocked input / forbidden tool). */
  BLOCK = 'BLOCK',
  /** The Shield permits the action only after a human approves it. */
  APPROVE_REQUIRED = 'APPROVE_REQUIRED',
}

/** The canonical request an autonomous decision is being made about. */
export interface ShieldDecisionSubject {
  /** What kind of autonomous action this decision authorises. */
  kind: 'tool_call' | 'input_scan' | 'self_modification';
  /** Optional tenant / workflow / run context the decision is scoped to. */
  tenantId?: string;
  workflowId?: string;
  runId?: string;
  /**
   * Content-addressed hash of the concrete request (tool name + input hash, or
   * the scan-text hash, or the revised-plan hash). Produced by the caller; the
   * Shield signs it so the agent cannot swap the request after a decision.
   */
  requestHash: string;
}

/** A Shield decision with its cryptographic signature. */
export interface ShieldSignedDecision {
  /** Content-addressed id (sha256 of subject|shieldId|issuedAt, first 32 hex). */
  decisionId: string;
  verdict: ShieldDecisionVerdict;
  subject: ShieldDecisionSubject;
  /** The Shield instance that signed (so multi-Shield audits can disambiguate). */
  shieldId: string;
  /** ISO-8601, caller-stamped. */
  issuedAt: string;
  /** ISO-8601, issuedAt + ttl. A decision past this time is no longer valid. */
  expiresAt: string;
  /** Ed25519 signature over the decision payload, hex-encoded. */
  signature: string;
}

/** A decision awaiting its signature (everything but decisionId + signature). */
export interface UnsignedShieldDecision {
  verdict: ShieldDecisionVerdict;
  subject: ShieldDecisionSubject;
  shieldId: string;
  issuedAt: string;
  expiresAt: string;
}

export interface ShieldDecisionVerification {
  valid: boolean;
  reason: string;
}

export interface ShieldDecisionReplay {
  /** The verdict the Shield recorded at decision-time. */
  verdict: ShieldDecisionVerdict;
  /** True when the stored decision still verifies under the public key and is unexpired. */
  valid: boolean;
  reason: string;
}

/** Accept a PEM string or a KeyObject and return a KeyObject (idempotent). */
function asKeyObject(key: string | KeyObject, kind: 'private' | 'public'): KeyObject {
  if (typeof key === 'string') {
    return kind === 'private' ? createPrivateKey(key) : createPublicKey(key);
  }
  return key;
}

/**
 * Canonicalise a decision subject into a stable, key-order-independent string.
 * Explicit field ordering avoids JSON.stringify key-order surprises across runtimes.
 */
export function canonicalizeSubject(subject: ShieldDecisionSubject): string {
  return `${subject.kind}|${subject.tenantId ?? ''}|${subject.workflowId ?? ''}|${subject.runId ?? ''}|${subject.requestHash}`;
}

/** The signed payload: every field that binds the agent to the Shield's verdict. */
export function decisionPayload(d: UnsignedShieldDecision & { decisionId: string }): string {
  return `${d.decisionId}|${d.verdict}|${canonicalizeSubject(d.subject)}|${d.shieldId}|${d.issuedAt}|${d.expiresAt}`;
}

/**
 * Content-addressed decision id: sha256 of (canonical subject | shieldId | issuedAt),
 * first 32 hex chars. Deterministic ⇒ the same decision is replayable by id.
 */
export function decisionIdFor(subject: ShieldDecisionSubject, shieldId: string, issuedAt: string): string {
  return createHash('sha256').update(`${canonicalizeSubject(subject)}|${shieldId}|${issuedAt}`).digest('hex').slice(0, 32);
}

/** Generate an Ed25519 key pair (PEM strings) — used by tests + local embedded mode. */
export function generateShieldKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
}

/**
 * Sign an unsigned decision with the Shield's Ed25519 private key. Computes the
 * decisionId, signs the payload, and returns the full signed decision.
 * Deterministic (Ed25519 deterministic nonce). Pure (no I/O, no Date.now).
 */
export function signDecision(unsig: UnsignedShieldDecision, signingKey: string | KeyObject): ShieldSignedDecision {
  const decisionId = decisionIdFor(unsig.subject, unsig.shieldId, unsig.issuedAt);
  const payload = decisionPayload({ ...unsig, decisionId });
  const keyObject = asKeyObject(signingKey, 'private');
  // Ed25519 ignores the digest algorithm; pass null per the one-shot sign() contract.
  const signature = edSign(null, Buffer.from(payload, 'utf8'), keyObject).toString('hex');
  return { decisionId, ...unsig, signature };
}

/** True when `now` (epoch ms) is at or past the decision's expiry. */
export function isExpired(decision: ShieldSignedDecision, now: number): boolean {
  const expiry = Date.parse(decision.expiresAt);
  if (Number.isNaN(expiry)) return true;
  return now >= expiry;
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Verify a signed decision against the Shield's PUBLIC key at `now` (epoch ms).
 * Recomputes the decisionId (detects subject/shieldId/issuedAt tampering),
 * re-checks the Ed25519 signature, and checks expiry. The agent holds only the
 * public key, so it can VERIFY but never FORGE. Pure + deterministic.
 */
export function verifyDecision(
  decision: ShieldSignedDecision,
  verificationKey: string | KeyObject,
  now: number,
): ShieldDecisionVerification {
  const expectedId = decisionIdFor(decision.subject, decision.shieldId, decision.issuedAt);
  if (!safeEqualHex(expectedId, decision.decisionId)) {
    return { valid: false, reason: 'decisionId mismatch (subject/shieldId/issuedAt tampered)' };
  }
  const payload = decisionPayload({ ...decision, decisionId: decision.decisionId });
  let ok = false;
  try {
    const keyObject = asKeyObject(verificationKey, 'public');
    ok = edVerify(null, Buffer.from(payload, 'utf8'), keyObject, Buffer.from(decision.signature, 'hex'));
  } catch {
    return { valid: false, reason: 'signature verification error' };
  }
  if (!ok) return { valid: false, reason: 'invalid signature' };
  if (isExpired(decision, now)) return { valid: false, reason: 'decision expired' };
  return { valid: true, reason: 'ok' };
}

/**
 * Audit replay seam: given a STORED decision, re-verify it under the public key
 * at `now` and re-surface the verdict the Shield recorded at decision-time. An
 * auditor can replay the exact decision the Shield made long after the run,
 * without trusting the agent's record. Pure.
 */
export function replayDecision(
  decision: ShieldSignedDecision,
  verificationKey: string | KeyObject,
  now: number,
): ShieldDecisionReplay {
  const v = verifyDecision(decision, verificationKey, now);
  return { verdict: decision.verdict, valid: v.valid, reason: v.reason };
}

// ─── verdict adapters (map the existing ShieldGateway outputs to verdicts) ─────

import type { ShieldToolCallEvaluation, ShieldInputScanResult } from './types.js';

/** A tool call that requires approval → APPROVE_REQUIRED, otherwise ALLOW. */
export function verdictFromToolEvaluation(ev: ShieldToolCallEvaluation): ShieldDecisionVerdict {
  return ev.requiresApproval ? ShieldDecisionVerdict.APPROVE_REQUIRED : ShieldDecisionVerdict.ALLOW;
}

/** An input scan that was blocked → BLOCK, otherwise ALLOW. */
export function verdictFromScan(scan: ShieldInputScanResult): ShieldDecisionVerdict {
  return scan.blocked ? ShieldDecisionVerdict.BLOCK : ShieldDecisionVerdict.ALLOW;
}