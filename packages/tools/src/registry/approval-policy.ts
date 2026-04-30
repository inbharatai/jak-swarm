/**
 * Centralized approval policy for tool execution.
 *
 * Closes the no-half-measures gap audit finding §3:
 *
 *   "`requiresApproval` flag on tool metadata defined; counted in stats
 *   at tool-registry.ts:382 — but NEVER consulted at execution time.
 *   The flag is currently DEAD."
 *
 * The policy is a single class with two methods:
 *
 *   1. `classify(metadata)` → ToolActionCategory (6-tier business
 *      taxonomy: SAFE_READ / WRITE / EXTERNAL_POST / DESTRUCTIVE /
 *      CREDENTIAL / INSTALL).
 *   2. `requiresApprovalFor(metadata, context)` → ApprovalDecision
 *      ({ required, category, reason }).
 *
 * Wired into `ToolRegistry.execute()` BEFORE the executor runs. When
 * approval is required and no `context.approvalId` is supplied, the
 * registry returns a structured `outcome: 'approval_required'` result
 * — it does NOT throw. Callers (BaseAgent, worker-node) handle the
 * outcome by pausing the workflow + emitting an `ApprovalRequest`.
 *
 * Tenant-scoped auto-approve bypass: a tenant that has explicitly
 * enabled `autoApproveCategory[CATEGORY] = true` for a given category
 * skips the approval gate for that category only — never globally,
 * never for DESTRUCTIVE, never cross-tenant. The default is
 * fail-closed (every sensitive category requires approval).
 */

import type { ToolMetadata, ToolExecutionContext } from '@jak-swarm/shared';

/**
 * 6-tier business-action taxonomy for tool calls. Independent of the
 * existing `ToolRiskClass` (which is a CAPABILITY label) and
 * `ToolRiskLevel` (which is a 6-tier capability lattice). This taxonomy
 * is OUTCOME-flavored: what does the action DO to the user's world?
 */
export enum ToolActionCategory {
  /** Reads public/permitted data. Cannot mutate anything. */
  SAFE_READ = 'SAFE_READ',
  /** Mutates internal state (sandbox/workspace/draft). No external commit. */
  WRITE = 'WRITE',
  /** Sends/posts to a third party (email, Slack message, social media post). */
  EXTERNAL_POST = 'EXTERNAL_POST',
  /** Deletes / overwrites prod data, executes refunds, mass operations. */
  DESTRUCTIVE = 'DESTRUCTIVE',
  /** Reads/writes/refreshes credentials, OAuth tokens, secrets, API keys. */
  CREDENTIAL = 'CREDENTIAL',
  /** Installs new tools/connectors/dependencies into the runtime. */
  INSTALL = 'INSTALL',
}

export interface ApprovalDecision {
  /** True if the tool may not run without an approvalId in context. */
  required: boolean;
  /** Classified category for audit + UI. */
  category: ToolActionCategory;
  /** Layman-readable reason ("Sending an email — needs your approval."). */
  reason: string;
}

/**
 * Tenant-supplied auto-approve override. Set per-category to allow
 * specific automation without prompting. NEVER applies to DESTRUCTIVE.
 *
 * Stored on the workflow execution context so a single workflow run
 * carries its own scope — never cross-tenant.
 */
export type AutoApproveCategoryMap = Partial<Record<ToolActionCategory, boolean>>;

export interface ApprovalPolicyContext extends ToolExecutionContext {
  /**
   * Tenant-scoped auto-approve overrides. Optional. When undefined or
   * missing a category, the default fail-closed posture applies.
   */
  autoApproveCategories?: AutoApproveCategoryMap;
}

/**
 * Classification heuristic. Combines:
 *   - explicit `metadata.requiresApproval` flag (highest signal)
 *   - `metadata.riskClass` from the registry
 *   - `metadata.sideEffectLevel` (read/write/destructive/external)
 *   - tool-name patterns for INSTALL / CREDENTIAL surfaces
 *
 * The order matters: more-dangerous categories win when ambiguous.
 */
function classifyCategory(metadata: ToolMetadata): ToolActionCategory {
  const name = metadata.name.toLowerCase();

  // Tool-name patterns — these are surface-level inferences but they
  // catch the cases where a tool's metadata wasn't tagged precisely.
  if (
    name.startsWith('install_') ||
    name.includes('connector_install') ||
    name.includes('package_install') ||
    name.includes('npm_install') ||
    name.startsWith('register_tool_') ||
    name.includes('add_connector')
  ) {
    return ToolActionCategory.INSTALL;
  }
  if (
    name.includes('oauth_authorize') ||
    name.includes('credential_') ||
    name.startsWith('connect_') ||
    name.includes('rotate_secret') ||
    name.includes('api_key')
  ) {
    return ToolActionCategory.CREDENTIAL;
  }

  // Side-effect axis (when present) — most reliable for read/write/destructive.
  if (metadata.sideEffectLevel === 'destructive') return ToolActionCategory.DESTRUCTIVE;
  // External READ (web_search, web_fetch) is sideEffectLevel='external'
  // BUT riskClass='READ_ONLY' — that combination is fine to run without
  // approval. Only treat 'external' as EXTERNAL_POST when the tool can
  // actually write/post to a third party.
  if (metadata.sideEffectLevel === 'external' && metadata.riskClass !== 'READ_ONLY') {
    return ToolActionCategory.EXTERNAL_POST;
  }

  // Risk-class axis — the legacy 4-tier capability label.
  if (metadata.riskClass === 'DESTRUCTIVE') return ToolActionCategory.DESTRUCTIVE;
  if (metadata.riskClass === 'EXTERNAL_SIDE_EFFECT') return ToolActionCategory.EXTERNAL_POST;
  if (metadata.riskClass === 'WRITE') return ToolActionCategory.WRITE;
  if (metadata.riskClass === 'READ_ONLY') return ToolActionCategory.SAFE_READ;

  // Risk-level axis (when sideEffectLevel + riskClass didn't narrow it).
  if (metadata.riskLevel === 'CRITICAL_MANUAL_ONLY') return ToolActionCategory.DESTRUCTIVE;
  if (metadata.riskLevel === 'EXTERNAL_ACTION_APPROVAL') return ToolActionCategory.EXTERNAL_POST;

  // Conservative default: anything we can't classify gets WRITE — high
  // enough to be tracked in audit log, low enough that it doesn't
  // block read-only flows from running.
  return ToolActionCategory.WRITE;
}

/**
 * Default approval policy. Stateless — one shared instance per process
 * is fine. Override only if a tenant ships a custom RBAC layer.
 */
export class DefaultApprovalPolicy {
  classify(metadata: ToolMetadata): ToolActionCategory {
    return classifyCategory(metadata);
  }

  requiresApprovalFor(
    metadata: ToolMetadata,
    context: ApprovalPolicyContext,
  ): ApprovalDecision {
    const category = classifyCategory(metadata);

    // Approval already granted upstream — caller (worker-node) attached
    // the approvalId after the user decided. Pass through.
    if (context.approvalId) {
      return {
        required: false,
        category,
        reason: `Approval ${context.approvalId} already granted; proceeding.`,
      };
    }

    // Tenant-scoped auto-approve override. NEVER applies to DESTRUCTIVE.
    const autoApproved =
      category !== ToolActionCategory.DESTRUCTIVE &&
      context.autoApproveCategories?.[category] === true;
    if (autoApproved) {
      return {
        required: false,
        category,
        reason: `Tenant has enabled auto-approve for ${category} actions.`,
      };
    }

    // Tool's explicit `requiresApproval` flag — explicit override of any
    // category-based default. This closes the "dead flag" gap.
    if (metadata.requiresApproval === true) {
      return {
        required: true,
        category,
        reason: `Tool '${metadata.name}' is marked requiresApproval=true. Awaiting human approval.`,
      };
    }

    // Category-based defaults.
    switch (category) {
      case ToolActionCategory.SAFE_READ:
        return {
          required: false,
          category,
          reason: 'Read-only — safe to execute without per-call approval.',
        };
      case ToolActionCategory.WRITE:
        return {
          required: false,
          category,
          reason: 'Internal write — tracked in audit log; no per-call approval gate.',
        };
      case ToolActionCategory.EXTERNAL_POST:
        return {
          required: true,
          category,
          reason: 'Sending or posting to a third party — your approval is required first.',
        };
      case ToolActionCategory.DESTRUCTIVE:
        return {
          required: true,
          category,
          reason: 'Destructive action — never auto-approves; needs your explicit OK.',
        };
      case ToolActionCategory.CREDENTIAL:
        return {
          required: true,
          category,
          reason: 'Credential or auth action — requires your approval.',
        };
      case ToolActionCategory.INSTALL:
        return {
          required: true,
          category,
          reason: 'Installing or registering a new tool — requires your approval.',
        };
    }
  }
}

/** Module-singleton — wire into ToolRegistry by default. */
export const defaultApprovalPolicy = new DefaultApprovalPolicy();
