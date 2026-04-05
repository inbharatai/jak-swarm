# JAK Swarm — Three-Tier Skill System

The JAK Swarm skill system provides a structured, safety-gated mechanism for extending agent capabilities. Skills are the vocabulary of what agents can do — each skill represents a named, versioned, permission-scoped capability with a defined input/output contract.

---

## Table of Contents

1. [Overview](#overview)
2. [Tier 1: Built-in Skills](#tier-1-built-in-skills)
3. [Tier 2: Generated Plan Skills](#tier-2-generated-plan-skills)
4. [Tier 3: Proposed Skills](#tier-3-proposed-skills)
5. [Skill Lifecycle](#skill-lifecycle)
6. [Review Queue](#review-queue)
7. [Sandboxing](#sandboxing)
8. [Approval Flow](#approval-flow)
9. [Risk Classification](#risk-classification)
10. [Skill Schema Reference](#skill-schema-reference)

---

## Overview

Every capability available to worker agents is expressed as a skill. Skills are linked to tool implementations but add a layer of:

- **Permission declaration** — what system access the skill requires
- **Risk classification** — what level of approval it needs before running
- **Schema contracts** — typed input/output specifications
- **Test cases** — automated validation before activation

The three-tier hierarchy describes how skills come into existence:

| Tier | Name | Created by | Requires Approval | Trust Level |
|---|---|---|---|---|
| 1 | Built-in | JAK Swarm platform team | No (pre-approved) | FULL |
| 2 | Generated Plan | Planner agent at runtime | No (auto-generated, sandboxed) | HIGH |
| 3 | Proposed | Tenant operator | Yes (human review required) | CONDITIONAL |

---

## Tier 1: Built-in Skills

**SkillTier.BUILTIN = 1**

Built-in skills are developed, tested, and shipped by the JAK Swarm platform team. They cover the core tool integrations: email, calendar, CRM, document management, spreadsheets, research, and knowledge retrieval.

**Characteristics:**
- Status is always `ACTIVE` — they cannot be disabled globally, only restricted by tenant settings
- No implementation field — they are compiled TypeScript code in `packages/tools/`
- Permissions are declared but enforced by the platform, not re-evaluated at runtime
- Test suites in `packages/tools/src/**/__tests__/`
- Updated only via platform releases, not tenant configuration

**Examples:**
- `email.send` — sends an email via the configured email provider
- `calendar.createEvent` — creates a calendar event with attendees
- `crm.searchContact` — searches CRM by email, phone, or name
- `knowledge.search` — full-text + semantic search over tenant knowledge base
- `browser.navigate` — navigates a headless browser to a URL

---

## Tier 2: Generated Plan Skills

**SkillTier.GENERATED_PLAN = 2**

Generated plan skills are lightweight skill descriptors created automatically by the Planner agent when it decomposes a goal into tasks. They are not code — they are structured descriptions of how to combine Tier 1 built-in tools to achieve a subtask.

**Characteristics:**
- No `implementation` field — they compose existing Tier 1 tools
- Automatically validated: Planner verifies all referenced tools exist in the registry
- Not persisted to the `skills` table by default (ephemeral to the workflow)
- If the same pattern occurs across multiple workflows, the system may promote a Tier 2 skill to Tier 3 for operator review and formalisation
- Risk level is derived from the highest-risk tool they compose

**Example:**
```json
{
  "name": "send-onboarding-email-sequence",
  "tier": 2,
  "description": "Read new contacts from CRM, draft personalised onboarding emails, and send in sequence with 24h intervals",
  "inputSchema": {
    "type": "object",
    "properties": {
      "segment": { "type": "string" },
      "templateId": { "type": "string" }
    }
  },
  "toolsComposed": ["crm.searchContact", "email.draft", "email.send"],
  "riskLevel": "HIGH"
}
```

---

## Tier 3: Proposed Skills

**SkillTier.PROPOSED = 3**

Proposed skills are operator-created extensions. They contain TypeScript implementation code that must pass static analysis, sandbox execution, and human approval before being activated.

**Characteristics:**
- Created via `POST /skills` by OPERATOR or TENANT_ADMIN role only
- Start with status `PROPOSED`
- Must declare all required permissions upfront
- Sandbox execution runs the skill against all provided test cases
- Require explicit TENANT_ADMIN approval to become `ACTIVE`
- Scoped to the tenant (or global if approvedBy is a platform admin)

**Use cases:**
- Custom integration with a proprietary internal system
- Industry-specific data transformation logic
- Multi-step composite actions specific to a tenant's process

---

## Skill Lifecycle

```
Operator proposes skill via API
          │
          ▼
     status: PROPOSED
          │
          ▼ (system triggers sandbox)
     status: SANDBOX_TESTING
          │
     ┌────┴────┐
     │         │
   PASS       FAIL
     │         │
     ▼         ▼
  Queued for  status: REJECTED
  human review (with sandbox error detail)
     │
     ▼
  TENANT_ADMIN reviews in UI
     │
  ┌──┴──┐
  │     │
APPROVE REJECT
  │     │
  ▼     ▼
APPROVED REJECTED
  │
  ▼
status: ACTIVE
  │
  ▼ (optionally, later)
status: DEPRECATED
```

---

## Review Queue

Proposed skills waiting for human review are surfaced in the operator dashboard at `/skills/review`.

The review UI shows:
- Skill name, description, and declared permissions
- Risk level and rationale
- Sandbox execution results (pass/fail per test case)
- Diff of implementation code with syntax highlighting
- One-click Approve / Reject with mandatory comment

Review actions require `TENANT_ADMIN` role. Once approved, the skill transitions to `APPROVED` status and is available to agents in the next workflow execution.

**SLA:** Skills in the review queue for more than 72 hours trigger an email notification to the tenant admin.

---

## Sandboxing

All Tier 3 skill implementations are executed in an isolated sandbox before approval:

**Sandbox environment:**
- Node.js `vm` module with a minimal global context
- Only these globals available: `JSON`, `Math`, `Date`, `console`, `setTimeout` (max 5s)
- No `process`, `require`, `import`, `fetch`, `fs`, `child_process`, `eval`
- Network calls are intercepted and blocked (replaced with mock responses for declared external tools)
- Memory limit: 128 MB
- Execution timeout: 10 seconds per test case

**Sandbox execution steps:**
1. Static analysis: ESLint + custom AST rules check for forbidden patterns
2. Bundle skill code into sandbox-safe module
3. For each `skill.testCases` entry: run skill with `testCase.input`
4. Validate output against `testCase.expectedOutputSchema`
5. Compare `testCase.shouldPass` with actual pass/fail
6. Store all results in `skill.sandboxResult` (JSON)

If all test cases pass, skill status advances from `SANDBOX_TESTING` to the review queue. If any test case fails, status becomes `REJECTED` with detailed failure output.

---

## Approval Flow

```
Sandbox passes all test cases
          │
          ▼
ApprovalRequest created (type: SKILL_REVIEW)
          │
          ▼
Notification sent to TENANT_ADMIN
          │
          ▼
Admin opens skill review UI
    • Views code, permissions, test results
    • Optionally adds a comment
          │
  ┌───────┴───────┐
  │               │
APPROVE         REJECT
  │               │
  ▼               ▼
skill.status    skill.status
= APPROVED      = REJECTED
  │
  ▼
Skill available to agents in workflow execution
```

Approved skills are immutable — any modification to an ACTIVE skill requires deprecating the current version and proposing a new one.

---

## Risk Classification

Skills inherit the risk class of their most dangerous declared permission:

| Permission | Default Risk Level |
|---|---|
| READ_EMAIL, READ_CALENDAR, READ_CRM, READ_DOCUMENTS | LOW |
| WRITE_EMAIL, WRITE_CALENDAR, WRITE_CRM, WRITE_DOCUMENTS | MEDIUM |
| BROWSER_READ | MEDIUM |
| EXTERNAL_MESSAGE, BROWSER_WRITE | HIGH |
| PAYMENT, DELETE_RECORDS | CRITICAL |

The system also considers the volume of operations:
- Bulk operations (> 100 records) automatically escalate risk by one level
- Operations touching financial data always floor at HIGH
- Operations in healthcare or legal industries floor at MEDIUM

Risk level determines whether the Approval Manager gate fires during workflow execution (see `requiresApproval()` in `packages/shared/src/constants/risk-levels.ts`).

---

## Skill Schema Reference

```typescript
interface Skill {
  id: string;
  name: string;
  description: string;
  tier: SkillTier;                // 1 | 2 | 3
  status: SkillStatus;            // ACTIVE | PROPOSED | SANDBOX_TESTING | APPROVED | REJECTED | DEPRECATED
  inputSchema: Record<string, unknown>;   // JSON Schema
  outputSchema: Record<string, unknown>;  // JSON Schema
  permissions: SkillPermission[];  // declared required permissions
  riskLevel: RiskLevel;
  testCases: SkillTestCase[];
  implementation?: string;        // TypeScript source — Tier 3 only
  sandboxResult?: unknown;        // Sandbox execution output
  approvedBy?: string;            // userId of approver
  approvedAt?: Date;
  createdAt: Date;
}

interface SkillTestCase {
  description: string;
  input: unknown;
  expectedOutputSchema: Record<string, unknown>;
  shouldPass: boolean;
}
```
