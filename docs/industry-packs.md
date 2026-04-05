# JAK Swarm — Industry Pack System

Industry packs allow JAK Swarm to specialise its agent behaviour, tool permissions, compliance rules, and approval thresholds for specific business verticals without modifying core agent code.

---

## Table of Contents

1. [Design Philosophy](#design-philosophy)
2. [Pack Structure](#pack-structure)
3. [Field Reference](#field-reference)
4. [How Packs Are Loaded](#how-packs-are-loaded)
5. [How Packs Are Applied](#how-packs-are-applied)
6. [Creating a New Pack](#creating-a-new-pack)
7. [Available Packs](#available-packs)
8. [Pack Overrides at Tenant Level](#pack-overrides-at-tenant-level)

---

## Design Philosophy

Industry packs are declarative configuration objects — not code. They do not contain agent logic; instead, they provide:

- **Vocabulary:** Keywords that help the router classify goals into sub-functions
- **Constraints:** Which tools are allowed or restricted
- **Compliance context:** Plain-English rules injected into Guardrail's policy set
- **Prompt supplements:** Additional instructions appended to agent system prompts
- **Approval thresholds:** Recommended risk level at which human approval should be required
- **KPI templates:** Suggested metrics dashboards for tenant operators

This separation means adding a new industry never requires modifying agent or tool code — only a new pack definition.

---

## Pack Structure

Each industry pack is a TypeScript object implementing the `IndustryPack` interface from `@jak-swarm/shared`:

```typescript
interface IndustryPack {
  industry: Industry;
  displayName: string;
  description: string;
  subFunctions: IndustrySubFunction[];
  defaultWorkflows: string[];
  allowedTools: ToolCategory[];
  restrictedTools: ToolCategory[];
  complianceNotes: string[];
  agentPromptSupplement: string;
  recommendedApprovalThreshold: RiskLevel;
  defaultKPITemplates: string[];
  policyOverlays: PolicyOverlay[];
}
```

Policy overlays within the pack:

```typescript
interface PolicyOverlay {
  name: string;
  rule: string;            // Human-readable policy statement
  enforcement: 'WARN' | 'BLOCK';
  appliesTo: ToolCategory[];
}
```

---

## Field Reference

| Field | Type | Description |
|---|---|---|
| `industry` | `Industry` | Enum value identifying the vertical |
| `displayName` | `string` | Human-readable name shown in the UI |
| `description` | `string` | Short description of the vertical's context |
| `subFunctions` | `string[]` | Domain-specific workflow categories (e.g. "patient-intake", "claims-processing") |
| `defaultWorkflows` | `string[]` | Names of pre-built workflow templates available to this industry |
| `allowedTools` | `ToolCategory[]` | Tool categories explicitly permitted for this industry |
| `restrictedTools` | `ToolCategory[]` | Tool categories blocked for this industry (overrides tenant allowedDomains) |
| `complianceNotes` | `string[]` | Plain-English compliance obligations (HIPAA, FERPA, PCI-DSS, etc.) |
| `agentPromptSupplement` | `string` | Text appended to Commander and Planner system prompts |
| `recommendedApprovalThreshold` | `RiskLevel` | Suggested minimum risk level for human approval |
| `defaultKPITemplates` | `string[]` | Dashboard metric template IDs relevant to this industry |
| `policyOverlays` | `PolicyOverlay[]` | Guardrail rules specific to this industry |

---

## How Packs Are Loaded

Packs are loaded at workflow start by the `IndustryPackLoader` service (in `packages/agents/src/industry/loader.ts`):

```
1. Workflow created with tenantId, goal, optional industry hint
2. If no industry hint: IndustryClassifier analyses goal text against INDUSTRY_KEYWORDS
3. Resolved Industry enum value used to select pack from INDUSTRY_PACK_REGISTRY
4. Pack passed to Commander as part of GoalContext
5. Commander attaches pack to all subsequent handoffs
```

The registry is a simple `Map<Industry, IndustryPack>` populated at application startup from the pack definitions in `packages/agents/src/industry/packs/`.

---

## How Packs Are Applied

### Commander & Planner
`agentPromptSupplement` is appended verbatim to the system prompts:
```
[Industry Context — Healthcare]
You are operating in a healthcare environment. All patient data is PHI under HIPAA.
Do not transmit patient identifiers outside the tenant's EMR system.
Require approval for any workflow step accessing more than one patient's record.
```

### Guardrail
`policyOverlays` are loaded into the Guardrail's policy engine. Each overlay is evaluated against the tool calls in the plan:
- `enforcement: 'WARN'` — allows execution but attaches a compliance annotation to the trace
- `enforcement: 'BLOCK'` — throws PolicyViolationError and halts execution

### Router
`restrictedTools` are merged into the Router's block list. Any task specifying a restricted tool category is rejected before dispatch.

`allowedTools` constrain which tool categories the Router will permit for this industry (all unlisted categories require explicit tenant opt-in).

### Approval Manager
`recommendedApprovalThreshold` is used as the fallback threshold when the tenant has not explicitly configured `approvalThreshold` in their settings.

---

## Creating a New Pack

1. Add the industry value to the `Industry` enum in `packages/shared/src/types/industry.ts`
2. Add display name to `INDUSTRY_DISPLAY_NAMES` in `packages/shared/src/constants/industries.ts`
3. Add keywords to `INDUSTRY_KEYWORDS`
4. Create a new pack file: `packages/agents/src/industry/packs/{industry-name}.pack.ts`

```typescript
// packages/agents/src/industry/packs/legal.pack.ts
import {
  Industry,
  RiskLevel,
  ToolCategory,
  type IndustryPack,
} from '@jak-swarm/shared';

export const legalPack: IndustryPack = {
  industry: Industry.LEGAL,
  displayName: 'Legal',
  description:
    'Law firms, in-house legal teams, and legal operations departments.',
  subFunctions: [
    'contract-review',
    'nda-management',
    'litigation-support',
    'compliance-monitoring',
    'document-drafting',
    'due-diligence',
    'matter-management',
  ],
  defaultWorkflows: [
    'contract-review-and-redline',
    'nda-intake-and-tracking',
    'due-diligence-document-analysis',
  ],
  allowedTools: [
    ToolCategory.DOCUMENT,
    ToolCategory.EMAIL,
    ToolCategory.CALENDAR,
    ToolCategory.KNOWLEDGE,
    ToolCategory.RESEARCH,
    ToolCategory.STORAGE,
  ],
  restrictedTools: [
    ToolCategory.BROWSER,    // No unsupervised web browsing in legal context
    ToolCategory.CRM,        // Client data isolation concerns
  ],
  complianceNotes: [
    'Attorney-client privilege: do not disclose communication contents outside the matter.',
    'Conflict of interest check required before accessing new matter data.',
    'All external communications must be logged as matter activities.',
    'Document retention follows jurisdiction-specific rules; do not delete without policy check.',
  ],
  agentPromptSupplement: `
[Industry Context — Legal]
You are operating in a legal environment. Treat all matter information as attorney-client privileged.
Never disclose the existence of a matter or its participants to anyone not named in the matter.
Flag any potential conflict of interest before proceeding with a workflow.
For contract review tasks, identify and flag: indemnification clauses, limitation of liability,
governing law, dispute resolution, and auto-renewal terms.
`,
  recommendedApprovalThreshold: RiskLevel.MEDIUM,
  defaultKPITemplates: [
    'matter-cycle-time',
    'contract-turnaround',
    'review-queue-depth',
  ],
  policyOverlays: [
    {
      name: 'no-external-matter-disclosure',
      rule: 'Matter identifiers and participant names must not appear in outbound communications to non-parties.',
      enforcement: 'BLOCK',
      appliesTo: [ToolCategory.EMAIL, ToolCategory.MESSAGING, ToolCategory.WEBHOOK],
    },
    {
      name: 'document-version-control',
      rule: 'Legal documents must never be overwritten — always create a new version.',
      enforcement: 'BLOCK',
      appliesTo: [ToolCategory.DOCUMENT, ToolCategory.STORAGE],
    },
    {
      name: 'external-research-citation',
      rule: 'All research outputs must include source citations with retrieval date.',
      enforcement: 'WARN',
      appliesTo: [ToolCategory.RESEARCH],
    },
  ],
};
```

5. Register the pack in `packages/agents/src/industry/registry.ts`:
```typescript
import { legalPack } from './packs/legal.pack.js';
// ...
INDUSTRY_PACK_REGISTRY.set(Industry.LEGAL, legalPack);
```

6. Add test coverage: `packages/agents/src/industry/packs/__tests__/legal.pack.test.ts`

---

## Available Packs

| Industry | Key Sub-Functions | Default Approval Threshold |
|---|---|---|
| Healthcare | patient-intake, claims-processing, appointment-scheduling | MEDIUM |
| Education | enrollment, grading, student-communications | HIGH |
| Retail | order-management, returns, inventory-sync | HIGH |
| Logistics | shipment-tracking, route-optimisation, dispatch | HIGH |
| Finance | reconciliation, invoice-processing, budget-reporting | MEDIUM |
| Insurance | claims-intake, policy-management, underwriting-support | MEDIUM |
| Recruiting | candidate-screening, interview-scheduling, offer-management | HIGH |
| Legal | contract-review, nda-management, due-diligence | MEDIUM |
| Hospitality | reservation-management, guest-communications, housekeeping | HIGH |
| Customer Support | ticket-triage, escalation, knowledge-base-qa | HIGH |
| Manufacturing | production-reporting, quality-incident, maintenance-scheduling | MEDIUM |
| Consulting | engagement-tracking, deliverable-management, client-reporting | HIGH |
| General | generic workflows with no industry-specific constraints | HIGH |

---

## Pack Overrides at Tenant Level

Tenant settings always take precedence over pack recommendations:

- `tenant.approvalThreshold` overrides `pack.recommendedApprovalThreshold`
- `tenant.enableBrowserAutomation = false` blocks BROWSER tools even if pack allows them
- `tenant.allowedDomains` further restricts all outbound tool calls

This means packs provide a sensible default that can be tightened (never loosened beyond global safety rules) at the tenant level.
