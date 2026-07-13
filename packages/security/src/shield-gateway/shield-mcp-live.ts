/**
 * shield-mcp-live.ts — PR E (Phase 10): instantiate the ShieldMcpClient in the
 * LIVE action path and route signed Shield decisions through the audit chain.
 *
 * Pre-PR-E the `ShieldMcpClient` was built + unit-tested but NEVER instantiated
 * in `apps/` (grep `new ShieldMcpClient` across apps/ → no matches). The live
 * Shield checks ran inline via `getShieldGateway().scanInput(...)` (ALLOW/WARN/
 * BLOCK) with NO signed, tamper-evident decision recorded. This module closes
 * that gap honestly:
 *
 *   - `getShieldMcpConfig()` provisions a LOCAL-embedded Shield keypair from env
 *     (`SHIELD_SIGNING_KEY` + `SHIELD_VERIFICATION_KEY`, Ed25519 PEMs) — the
 *     same fail-open-to-auditable pattern as the audit chain's
 *     `EVIDENCE_SIGNING_SECRET`. When the keys are absent the signed-decision
 *     path is INACTIVE and the existing unsigned `scanInput` path is unchanged
 *     (the agent still gets Shield checks, just without a signed artifact).
 *
 *   - `requestSignedInputScanDecision()` runs the REAL `scanInput` (for the
 *     actual block/allow + blockReasons), derives the verdict via the pure
 *     `verdictFromScan`, builds the `ShieldDecisionSubject` (kind `input_scan`,
 *     `requestHash = sha256(text)` so the agent cannot swap the text after a
 *     decision), INSTANTIATES a `ShieldMcpClient` with the provisioned keypair
 *     + a `verdictFor` that returns the precomputed verdict, requests the
 *     signed decision, and VERIFIES it under the public key on receipt
 *     (fail-closed — an unverifiable decision is never returned for action).
 *
 *   - `recordShieldDecisionToAudit()` routes the signed decision through the
 *     EXISTING audit chain via `AuditLogger.log` (which now appends atomically
 *     — see audit-chain.ts). The audit row carries `decisionId`, `verdict`,
 *     `shieldId`, `issuedAt`/`expiresAt`, the subject, and the block reasons —
 *     so an auditor can `replayDecision` the exact signed verdict the Shield
 *     issued at decision-time, long after the run.
 *
 * Honest scope:
 *   - This is the LOCAL-embedded Shield (in-process). The REMOTE MCP transport
 *     to a standalone JAK Shield service remains roadmap (the `transport`
 *     option is wired but no live remote endpoint is configured here).
 *   - The signed-decision path is a CANARY: it activates only when the keypair
 *     is provisioned AND `SHIELD_MCP_CANARY=1`. It does NOT replace the
 *     existing `scanInput` block/allow behaviour — it ADDS a signed, audited
 *     artifact on top. Default-off so existing behaviour is unchanged.
 */
import { createHash } from 'node:crypto';
import { ShieldMcpClient } from './shield-mcp-client.js';
import {
  ShieldDecisionVerdict,
  verdictFromScan,
  type ShieldDecisionSubject,
  type ShieldSignedDecision,
} from './signed-decision.js';
import { getShieldGateway } from './gateway.js';
import type { ShieldInputScanResult, ShieldScanContext } from './types.js';
import { AuditLogger, AuditAction, type AuditEvent } from '../audit/audit-log.js';

/** Provisoned Shield keypair + identity (LOCAL embedded). Null when the env
 *  keys are absent → the signed-decision path is INACTIVE (fail-open). */
export interface ShieldMcpConfig {
  shieldId: string;
  signingKey: string;
  verificationKey: string;
}

let cachedConfig: ShieldMcpConfig | null | undefined;

/**
 * Load + memoise the LOCAL-embedded Shield keypair from env. Returns null when
 * either key is absent (the signed-decision path stays inactive; the existing
 * unsigned `scanInput` path is unchanged). `SHIELD_ID` defaults to
 * 'jak-shield-local'. Never throws.
 */
export function getShieldMcpConfig(): ShieldMcpConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  const signingKey = process.env['SHIELD_SIGNING_KEY']?.trim();
  const verificationKey = process.env['SHIELD_VERIFICATION_KEY']?.trim();
  if (!signingKey || !verificationKey) {
    cachedConfig = null;
    return null;
  }
  cachedConfig = {
    shieldId: process.env['SHIELD_ID']?.trim() || 'jak-shield-local',
    signingKey,
    verificationKey,
  };
  return cachedConfig;
}

/** True when the signed-decision path is ACTIVE (keypair provisioned + canary on). */
export function shieldMcpActive(): boolean {
  return getShieldMcpConfig() !== null && process.env['SHIELD_MCP_CANARY'] === '1';
}

/** Reset the memoised config (for tests that toggle env vars). */
export function resetShieldMcpConfigCache(): void {
  cachedConfig = undefined;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface SignedInputScanResult {
  scan: ShieldInputScanResult;
  decision: ShieldSignedDecision;
}

/**
 * Run the REAL `scanInput` for `text` + derive + sign a Shield decision at
 * `now` (epoch ms). Returns `{ scan, decision }` with a VERIFIED signature
 * (fail-closed: an unverifiable decision throws — it is never returned for the
 * caller to act on). Returns null when the signed-decision path is INACTIVE
 * (keypair absent) — the caller falls back to the unsigned `scan` alone.
 *
 * The `ShieldMcpClient` is INSTANTIATED here (in the live action path) with the
 * provisioned keypair + a `verdictFor` that returns the precomputed
 * `verdictFromScan(scan)` verdict. The subject's `requestHash = sha256(text)`
 * commits to the exact scanned text, so the agent cannot swap the input after
 * the Shield signs.
 */
export async function requestSignedInputScanDecision(input: {
  text: string;
  context?: ShieldScanContext;
  now: number;
  /** Optional precomputed scan (avoids a double scan when the caller already ran
   *  `scanInput` for the unsigned block/allow path). When omitted the scan runs
   *  here. */
  scan?: ShieldInputScanResult;
}): Promise<SignedInputScanResult | null> {
  const config = getShieldMcpConfig();
  // Run the real scan regardless — the unsigned block/allow behaviour must not
  // depend on the canary. The signed decision is layered on top. Reuse the
  // caller's scan when supplied (the live path already scanned for injection/PII).
  const scan = input.scan ?? (await getShieldGateway().scanInput(input.text, input.context));
  if (!config) return null; // INACTIVE — return the scan only, no signed artifact
  const verdict: ShieldDecisionVerdict = verdictFromScan(scan);
  const subject: ShieldDecisionSubject = {
    kind: 'input_scan',
    tenantId: input.context?.tenantId,
    workflowId: input.context?.workflowId,
    runId: input.context?.runId,
    requestHash: sha256Hex(input.text),
  };
  const client = new ShieldMcpClient({
    shieldId: config.shieldId,
    verificationKey: config.verificationKey,
    signingKey: config.signingKey,
    // verdictFor returns the precomputed verdict — the scan already ran; the
    // signed decision commits to that verdict for this requestHash.
    verdictFor: () => verdict,
  });
  const decision = await client.requestDecision(subject, input.now);
  // Fail-closed: verify the decision we just signed under the public key before
  // returning it for audit. A verification failure here indicates key
  // misconfiguration (signing ≠ verification key) — never surface an
  // unverifiable decision.
  const verification = client.verify(decision, input.now);
  if (!verification.valid) {
    throw new Error(`Shield decision failed self-verification: ${verification.reason}`);
  }
  return { scan, decision };
}

/**
 * Route a signed Shield decision through the existing audit chain via
 * `AuditLogger.log` (atomic append — see audit-chain.ts). The audit row carries
 * the `decisionId` (resourceId), verdict, shieldId, issue/expiry times, the
 * signed subject, and the scan's block reasons — enough for an auditor to
 * `replayDecision` the exact signed verdict later. Severity is WARN when the
 * Shield blocked, INFO otherwise. Never throws (audit must not break the flow).
 */
export async function recordShieldDecisionToAudit(
  audit: AuditLogger,
  input: {
    decision: ShieldSignedDecision;
    scan: ShieldInputScanResult;
    tenantId: string;
    userId?: string;
    workflowId?: string;
    source: NonNullable<ShieldScanContext['source']>;
  },
): Promise<void> {
  const event: AuditEvent = {
    action: AuditAction.SHIELD_DECISION_SIGNED,
    tenantId: input.tenantId,
    ...(input.userId !== undefined && { userId: input.userId }),
    resource: 'shield_decision',
    resourceId: input.decision.decisionId,
    details: {
      verdict: input.decision.verdict,
      shieldId: input.decision.shieldId,
      issuedAt: input.decision.issuedAt,
      expiresAt: input.decision.expiresAt,
      subject: input.decision.subject,
      blockReasons: input.scan.blockReasons,
      source: input.source,
      ...(input.workflowId !== undefined && { workflowId: input.workflowId }),
    },
    severity: input.decision.verdict === ShieldDecisionVerdict.BLOCK ? 'WARN' : 'INFO',
  };
  try {
    await audit.log(event);
  } catch (err) {
    // Audit must never break the request flow — mirror AuditLogger's own guard.
    console.error('[shield-mcp-live] failed to record signed decision to audit chain:', err);
  }
}