/**
 * shield-mcp-client.ts — HyperAgent Phase 8: the Shield MCP client.
 *
 * The HyperAgent is a CLIENT of JAK Shield, never its peer. Before any autonomous
 * action it requests a SIGNED decision from the Shield; it may act only when the
 * returned decision verifies under the Shield's public key, is unexpired, and
 * carries verdict ALLOW. The agent holds the PUBLIC key only — it can verify but
 * never forge a decision, so it cannot self-authorise, bypass the Shield, or
 * weaken approval controls (per the standing security constraints).
 *
 * Two modes, selected by options:
 *
 *   - LOCAL embedded (`signingKey` + `verdictFor`, no `transport`): the Shield
 *     runs in-process. The client computes the verdict via the injected `verdictFor`
 *     (which wraps the embedded ShieldGateway policy), then signs with the private
 *     key. The private key is held by the runtime that builds the client, NOT by
 *     the agents — agents receive a `ShieldMcpClient`, never the key.
 *
 *   - REMOTE MCP (`transport`): the Shield is a standalone service/MCP gateway.
 *     The client calls the transport and VERIFIES the returned decision with the
 *     public key on receipt — a tampered or forged response is rejected with
 *     `ShieldDecisionUnverifiableError`. The private key never leaves the Shield.
 *
 * `replay(decision, now)` is the audit seam: re-verify a stored decision and
 * re-surface its verdict. Pure cores in signed-decision.ts; this client wires I/O.
 */
import type { KeyObject } from 'node:crypto';
import {
  signDecision,
  verifyDecision,
  replayDecision,
} from './signed-decision.js';
import type {
  ShieldDecisionSubject,
  ShieldDecisionVerdict,
  ShieldSignedDecision,
  ShieldDecisionVerification,
  ShieldDecisionReplay,
  UnsignedShieldDecision,
} from './signed-decision.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Thrown when a decision returned by a remote transport fails verification. */
export class ShieldDecisionUnverifiableError extends Error {
  constructor(public readonly reason: string) {
    super(`Shield decision failed verification: ${reason}`);
    this.name = 'ShieldDecisionUnverifiableError';
  }
}

/** Thrown when the client is misconfigured for the requested mode. */
export class ShieldMcpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShieldMcpConfigError';
  }
}

/**
 * REMOTE mode: a transport to a standalone JAK Shield MCP server. The transport
 * returns a signed decision; the client verifies it with the public key.
 */
export interface ShieldMcpTransport {
  requestSignedDecision(subject: ShieldDecisionSubject, now: string): Promise<ShieldSignedDecision>;
}

export interface ShieldMcpClientOptions {
  shieldId: string;
  /** The Shield's public key (PEM) — used to verify decisions in BOTH modes. */
  verificationKey: string | KeyObject;
  /** The Shield's private key (PEM) — LOCAL embedded mode only. */
  signingKey?: string | KeyObject;
  /** Decision TTL in ms (default 5 minutes). */
  ttlMs?: number;
  /**
   * LOCAL mode: the embedded Shield policy as a pure verdict function. Required
   * when `signingKey` is set and no `transport` is supplied. The agent never
   * supplies this — it is bound by the runtime when the client is constructed.
   */
  verdictFor?: (subject: ShieldDecisionSubject) => ShieldDecisionVerdict;
  /** REMOTE mode: transport to a standalone JAK Shield MCP server. */
  transport?: ShieldMcpTransport;
}

function isoAt(now: number): string {
  return new Date(now).toISOString();
}

export class ShieldMcpClient {
  readonly shieldId: string;
  private readonly verificationKey: string | KeyObject;
  private readonly signingKey?: string | KeyObject;
  private readonly ttlMs: number;
  private readonly verdictFor?: (subject: ShieldDecisionSubject) => ShieldDecisionVerdict;
  private readonly transport?: ShieldMcpTransport;

  constructor(options: ShieldMcpClientOptions) {
    if (!options.transport && !options.signingKey) {
      throw new ShieldMcpConfigError('ShieldMcpClient requires either a transport (remote) or a signingKey (local embedded)');
    }
    if (!options.transport && !options.verdictFor) {
      throw new ShieldMcpConfigError('Local embedded mode requires a verdictFor policy function');
    }
    this.shieldId = options.shieldId;
    this.verificationKey = options.verificationKey;
    this.signingKey = options.signingKey;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.verdictFor = options.verdictFor;
    this.transport = options.transport;
  }

  /**
   * Request a signed decision for an autonomous action at `now` (epoch ms).
   * LOCAL: computes the verdict via `verdictFor` and signs it. REMOTE: calls the
   * transport and verifies the returned decision with the public key.
   */
  async requestDecision(subject: ShieldDecisionSubject, now: number): Promise<ShieldSignedDecision> {
    const issuedAt = isoAt(now);
    if (this.transport) {
      const raw = await this.transport.requestSignedDecision(subject, issuedAt);
      const v = verifyDecision(raw, this.verificationKey, now);
      if (!v.valid) throw new ShieldDecisionUnverifiableError(v.reason);
      // The transport's signature is authoritative; refuse any decision whose id
      // does not match the subject we asked about (defends against substitution).
      return raw;
    }
    if (!this.signingKey || !this.verdictFor) {
      throw new ShieldMcpConfigError('Local embedded mode requires both signingKey and verdictFor');
    }
    const verdict = this.verdictFor(subject);
    const unsig: UnsignedShieldDecision = {
      verdict,
      subject,
      shieldId: this.shieldId,
      issuedAt,
      expiresAt: isoAt(now + this.ttlMs),
    };
    return signDecision(unsig, this.signingKey);
  }

  /** Verify a stored decision under the public key at `now` (epoch ms). */
  verify(decision: ShieldSignedDecision, now: number): ShieldDecisionVerification {
    return verifyDecision(decision, this.verificationKey, now);
  }

  /** Audit replay: re-verify a stored decision and re-surface its verdict. */
  replay(decision: ShieldSignedDecision, now: number): ShieldDecisionReplay {
    return replayDecision(decision, this.verificationKey, now);
  }
}