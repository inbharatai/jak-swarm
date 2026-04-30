/**
 * Browser-operator runtime types.
 *
 * The interface every adapter must satisfy. Today's
 * `PlaywrightBrowserOperator` is the reference implementation —
 * platform-specific adapters (LinkedIn / Instagram review flows)
 * compose on top via the propose/execute action map.
 */

import { ToolActionCategory } from '../registry/approval-policy.js';

export type BrowserPlatform =
  | 'INSTAGRAM'
  | 'LINKEDIN'
  | 'YOUTUBE_STUDIO'
  | 'META_BUSINESS_SUITE'
  | 'GENERIC'; // Generic = "user picks a URL" — the foundation that all platform adapters build on.

export interface PageObservation {
  /** Current page URL. */
  url: string;
  /** Page title (best-effort). */
  title: string;
  /** Page-level accessibility text (the body's innerText, capped). */
  accessibilityText: string;
  /** Server-side timestamp when observation was captured. */
  observedAt: Date;
  /**
   * True when the platform shows a 2FA / captcha challenge — the
   * cockpit must surface "user takeover required" UX and stop.
   * Heuristic match on common keywords; not a hard guarantee.
   */
  blockedBySecurity: boolean;
  /** Filesystem path of the screenshot artifact (PNG). */
  screenshotPath: string;
}

export type ProposedActionKind =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'screenshot_only'
  | 'extract_text';

export interface ProposedAction {
  /** Action kind drives ApprovalPolicy classification. */
  kind: ProposedActionKind;
  /** Layman-friendly summary shown in the ApprovalRequest card. */
  description: string;
  /** Structured payload — passed verbatim to the executor. */
  payload: {
    url?: string;
    selector?: string;
    text?: string;
    [key: string]: unknown;
  };
}

export interface ProposedActionPreview {
  /** What JAK would do, in layman English. */
  summary: string;
  /** ApprovalPolicy category for this action. */
  category: ToolActionCategory;
  /** Whether this action requires a human approval before execute. */
  approvalRequired: boolean;
  /** Hash of the payload — bound to ApprovalRequest.proposedDataHash. */
  proposedDataHash: string;
}

export interface ExecutionResult {
  success: boolean;
  /** Path of the post-action screenshot. */
  screenshotPath?: string;
  /** Any error message, surface-friendly. */
  error?: string;
  /** Final URL after the action (if it changed the page). */
  finalUrl?: string;
}

export interface BrowserSessionInfo {
  sessionId: string;
  tenantId: string;
  userId: string;
  platform: BrowserPlatform;
  workflowId?: string;
  initialUrl: string;
  createdAt: Date;
  /** Whether the underlying browser is still connected. */
  alive: boolean;
}

export interface StartSessionInput {
  tenantId: string;
  userId: string;
  platform: BrowserPlatform;
  /** Workflow that owns this session (for audit trail linking). */
  workflowId?: string;
  /** Initial URL to navigate to. Must be in the allowlist. */
  initialUrl: string;
}

export interface BrowserOperatorService {
  /** Start a fresh per-tenant session. Returns sessionId + URL the user can open. */
  startSession(input: StartSessionInput): Promise<{ sessionId: string; loginUrl: string }>;

  /** Observe the current page state. */
  observe(input: { sessionId: string; tenantId: string }): Promise<PageObservation>;

  /** Propose an action — produces a structured preview without executing. */
  propose(input: {
    sessionId: string;
    tenantId: string;
    action: ProposedAction;
  }): Promise<ProposedActionPreview>;

  /**
   * Execute an approved action. Caller MUST include `approvalId`
   * proving the ApprovalRequest was decided APPROVED. Throws
   * `ApprovalRequiredError` otherwise.
   */
  execute(input: {
    sessionId: string;
    tenantId: string;
    action: ProposedAction;
    approvalId: string;
  }): Promise<ExecutionResult>;

  /** List all sessions for a tenant. */
  listSessions(tenantId: string): Promise<BrowserSessionInfo[]>;

  /** Close + dispose the session. */
  endSession(input: { sessionId: string; tenantId: string }): Promise<void>;
}

/** Thrown when execute() is called without a valid approvalId. */
export class ApprovalRequiredError extends Error {
  readonly category: ToolActionCategory;
  constructor(category: ToolActionCategory, message: string) {
    super(message);
    this.name = 'ApprovalRequiredError';
    this.category = category;
  }
}

/** Thrown when a session is not found OR belongs to a different tenant. */
export class SessionAccessError extends Error {
  constructor(reason: 'not_found' | 'wrong_tenant') {
    super(`Browser session access denied: ${reason}`);
    this.name = 'SessionAccessError';
  }
}
