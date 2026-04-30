/**
 * Browser-operator runtime — interface + stub implementation.
 *
 * Phase 5 Path B: builds the contract every browser-operator adapter
 * must satisfy. The full Playwright-backed implementation ships in
 * Sprint 1 of `docs/browser-operator-runtime-plan.md`.
 *
 * Today this file ships:
 *   1. The interface (`BrowserOperatorService`)
 *   2. A `NotImplementedBrowserOperator` stub that throws clearly so
 *      any callsite that imports it before the runtime ships gets a
 *      crash-loud error — NOT silent fake success.
 *
 * The HTTP routes that surface this to the dashboard are
 * intentionally NOT registered yet (per the roadmap, registration
 * happens in Sprint 1 along with the real Playwright-backed adapter).
 */

export type BrowserPlatform =
  | 'INSTAGRAM'
  | 'LINKEDIN'
  | 'YOUTUBE_STUDIO'
  | 'META_BUSINESS_SUITE';

export interface PageObservation {
  /** Current page URL (for audit log). */
  url: string;
  /** Accessibility-tree snapshot (NOT raw HTML — strips form values
   *  for password / login fields). */
  snapshot: unknown;
  /** Server-side timestamp when observation was captured. */
  observedAt: Date;
  /** True when the platform shows a 2FA / captcha challenge — caller
   *  must surface "user takeover required" UX and stop. */
  blockedBySecurity: boolean;
}

export interface ProposedAction {
  /** Action category (drives ApprovalPolicy classification). */
  kind: 'review_profile' | 'draft_post' | 'publish_post' | 'send_message' | 'edit_profile';
  /** Layman-friendly summary shown in the ApprovalRequest card. */
  description: string;
  /** Structured payload — passed verbatim to the executor. */
  payload: Record<string, unknown>;
}

export interface ProposedActionPreview {
  /** What JAK would do, in layman English. */
  summary: string;
  /** What changes (if any) — diff-style preview. */
  changes: Array<{ field: string; before?: string; after: string }>;
  /** Hash of the payload — bound to ApprovalRequest.proposedDataHash. */
  proposedDataHash: string;
  /** Whether this action requires a human approval before execute. */
  approvalRequired: boolean;
}

export interface ExecutionResult {
  success: boolean;
  /** Audit log artifact ID (the screenshot proving what happened). */
  screenshotArtifactId?: string;
  /** Any error message, surface-friendly. */
  error?: string;
}

export interface BrowserOperatorService {
  startSession(input: {
    tenantId: string;
    userId: string;
    platform: BrowserPlatform;
    workflowId: string;
  }): Promise<{ sessionId: string; loginUrl: string }>;

  observe(sessionId: string): Promise<PageObservation>;

  propose(input: {
    sessionId: string;
    action: ProposedAction;
  }): Promise<ProposedActionPreview>;

  execute(input: {
    sessionId: string;
    action: ProposedAction;
    approvalId: string;
  }): Promise<ExecutionResult>;

  endSession(sessionId: string): Promise<void>;
}

/**
 * Crash-loud stub. ANY call to this implementation throws with a clear
 * message pointing at the roadmap doc. This is the OPPOSITE of fake
 * success — a developer who wires this up before the real runtime
 * ships gets immediate, obvious failure.
 */
export class NotImplementedBrowserOperator implements BrowserOperatorService {
  private notImplemented(method: string): never {
    throw new Error(
      `BrowserOperatorService.${method} is not implemented yet. ` +
        `See docs/browser-operator-runtime-plan.md for the implementation plan ` +
        `(Sprint 1 ships the Playwright runtime).`,
    );
  }

  async startSession(): Promise<{ sessionId: string; loginUrl: string }> {
    return this.notImplemented('startSession');
  }
  async observe(): Promise<PageObservation> {
    return this.notImplemented('observe');
  }
  async propose(): Promise<ProposedActionPreview> {
    return this.notImplemented('propose');
  }
  async execute(): Promise<ExecutionResult> {
    return this.notImplemented('execute');
  }
  async endSession(): Promise<void> {
    return this.notImplemented('endSession');
  }
}

/**
 * Default export — the stub. Future Sprint 1 work replaces this with
 * `PlaywrightBrowserOperator` and adds the corresponding HTTP routes.
 */
export const browserOperator: BrowserOperatorService = new NotImplementedBrowserOperator();
