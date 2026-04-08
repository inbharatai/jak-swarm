# JAK Swarm — Community Builder Output
*Generated: 2026-04-08*

---

## ISSUE 1 — Good First Issue

### Title
`Add unit tests for the anti-hallucination pipeline`

### Labels
`good-first-issue` · `testing` · `help-wanted` · `documentation`

---

**Problem**

`packages/agents/src/base/anti-hallucination.ts` contains five well-structured, pure-function detection utilities that are central to JAK Swarm's 4-layer anti-hallucination guarantee:

| Function | What it does |
|---|---|
| `groundingCheck` | Scores agent output against tool results |
| `detectInventedStatistics` | Flags unsourced percentages, dollar amounts, counts |
| `detectFabricatedSources` | Catches fake citations and academic references |
| `detectOverconfidence` | Detects certainty language without evidence |
| `detectImpossibleClaims` | Flags future events stated as fact, LLM personal experience |

Despite being core safety infrastructure, **none of these functions have a dedicated test file**. The only existing tool test (`tests/unit/tools/tool-registry.test.ts`) covers tool registration — not content safety. A regression in any of these functions could silently allow hallucinated outputs into production.

**Expected Behavior**

A new test file `tests/unit/agents/anti-hallucination.test.ts` should exist with at least one `it()` block per exported function covering:
- A clean input that passes (no issues found)
- A dirty input that correctly flags the problem
- Edge cases: empty string, no tool results provided

**Steps to Implement**

1. Create `tests/unit/agents/anti-hallucination.test.ts`
2. Import the functions from `packages/agents/src/base/anti-hallucination.ts`
3. Write tests using `vitest` (already configured in `tests/vitest.config.ts`)
4. Run with `pnpm test` from the `tests/` directory

**Example skeleton to get you started:**

```typescript
import { describe, it, expect } from 'vitest';
import {
  groundingCheck,
  detectInventedStatistics,
  detectFabricatedSources,
  detectOverconfidence,
  detectImpossibleClaims,
  fullHallucinationCheck,
} from '../../../packages/agents/src/base/anti-hallucination.js';

describe('detectInventedStatistics', () => {
  it('returns empty array for clean text', () => {
    const result = detectInventedStatistics('The sky is blue and grass is green.');
    expect(result).toHaveLength(0);
  });

  it('flags unsourced percentages', () => {
    const result = detectInventedStatistics('Our product increased revenue by 73%.');
    expect(result.length).toBeGreaterThan(0);
  });
});

// TODO: add describe blocks for groundingCheck, detectFabricatedSources,
// detectOverconfidence, detectImpossibleClaims, fullHallucinationCheck
```

**Files to Modify / Create**

- `tests/unit/agents/anti-hallucination.test.ts` ← create this
- No production code changes required

**Acceptance Criteria**

- [ ] All 5 exported detection functions have at least 2 test cases each
- [ ] `fullHallucinationCheck` has an end-to-end test with severity = `'critical'` and severity = `'none'`
- [ ] `pnpm test` passes with no failures
- [ ] Test file follows the same structure as `tests/unit/agents/guardrail.test.ts`

**Good to know**

- The functions are pure TypeScript — no database, no LLM calls, no external dependencies
- Expected time investment: 1–2 hours
- This is a great way to understand how JAK Swarm prevents hallucinations before contributing to the agents themselves

---

## ISSUE 2 — Feature Request / Enhancement

### Title
`[Enhancement] Linear integration: first-class tools for project-management agents`

### Labels
`enhancement` · `integration` · `help-wanted` · `area: tools`

---

**Why This Matters**

Linear is where most engineering teams track work. JAK Swarm already lists Linear as an MCP provider and has a `Project` agent and an `Ops` agent — but today those agents can only reach Linear through the generic MCP bridge with no dedicated tool schema, no typed inputs, and no error handling.

This means if you say *"Create a Linear issue for the bug the Analytics agent just found"*, the swarm has no reliable, structured way to do it. A first-class Linear integration would make JAK Swarm genuinely useful as an autonomous engineering co-pilot.

**What "first-class" means here**

New tools registered in `packages/tools/src/builtin/` with full Zod schemas, risk classification, and category tags — exactly like the existing `send_email` or `update_crm_record` tools:

| Tool name | Description | Risk class |
|---|---|---|
| `linear_create_issue` | Create a new issue in a team's backlog | `WRITE` |
| `linear_update_issue` | Update title, status, assignee, priority | `WRITE` |
| `linear_search_issues` | Search by query, label, state, or assignee | `READ_ONLY` |
| `linear_get_issue` | Fetch a single issue by ID | `READ_ONLY` |
| `linear_list_projects` | List all Linear projects for the workspace | `READ_ONLY` |

**Proposed Input/Output Schemas**

```typescript
// linear_create_issue
input: {
  teamId: string;          // Linear team ID
  title: string;
  description?: string;   // Markdown supported
  priority?: 0 | 1 | 2 | 3 | 4;  // 0=no priority, 1=urgent, 4=low
  labelIds?: string[];
  assigneeId?: string;
  estimate?: number;       // Story points
}
output: {
  issueId: string;
  url: string;
  identifier: string;      // e.g. "ENG-142"
}

// linear_search_issues
input: {
  query?: string;
  teamId?: string;
  stateId?: string;        // "In Progress", "Done", etc.
  assigneeId?: string;
  labelIds?: string[];
  first?: number;          // default 25, max 100
}
output: {
  issues: Array<{
    id: string;
    identifier: string;
    title: string;
    state: string;
    priority: number;
    url: string;
    assignee?: string;
  }>
}
```

**How to Implement**

1. Add a `linear` client in `packages/tools/src/clients/linear.ts` using the [Linear SDK](https://github.com/linear/linear/tree/master/packages/sdk)
2. Register the 5 tools in `packages/tools/src/builtin/index.ts` under `ToolCategory.PROJECT_MANAGEMENT`
3. Mark `linear_create_issue` and `linear_update_issue` with `requiresApproval: true` (write operations)
4. Add `LINEAR_API_KEY` to `.env.example`
5. Assign the new tools to `AgentRole.PROJECT` and `AgentRole.OPS` in the agent definitions
6. Write unit tests in `tests/unit/tools/linear-tools.test.ts` using mocked SDK responses

**Bonus (stretch goal)**

Add a `linear_webhook_handler` to `apps/api/` so Linear can trigger JAK Swarm workflows when issues change state — e.g., auto-summarize a completed sprint, or alert the Success agent when a customer-reported bug is resolved.

**Acceptance Criteria**

- [ ] All 5 tools pass `registry.get('linear_*')` in the tool registry tests
- [ ] `linear_search_issues` and `linear_get_issue` have `requiresApproval: false`
- [ ] `linear_create_issue` and `linear_update_issue` have `requiresApproval: true`
- [ ] `LINEAR_API_KEY` added to `.env.example` with documentation comment
- [ ] At least one integration test exercising the full `goal → planner → project agent → linear_create_issue` path

---

## DISCUSSION POST

### Category: `Ideas` / `Show and Tell`

### Title
`Architecture deep-dive: How JAK Swarm turns a plain-English goal into a parallel task graph`

---

Hey everyone 👋

One of the questions I see most often is: *"How does JAK Swarm actually know what to do when I give it a goal like 'Run a Q2 sales campaign'?"*

The answer is a 5-stage pipeline that most multi-agent frameworks skip entirely. Let me walk through it.

---

### Stage 1 — The Commander parses and validates

Every workflow starts at the `Commander` agent. It does three things before passing work to anyone else:

1. **Normalises the goal** into a canonical intent (strips ambiguity, canonicalises entities)
2. **Runs a Guardrail pre-flight** — checks the goal against policy rules *before* spending tokens on planning
3. **Selects an industry pack** — if your tenant is tagged `finance`, all downstream agents inherit finance-specific tool restrictions and approval thresholds

No tools are called here. The Commander is an orchestrator — it only routes.

---

### Stage 2 — The Planner builds a DAG

The `Planner` agent receives the validated goal and outputs a **Directed Acyclic Graph (DAG)** of atomic tasks. Each node looks like:

```json
{
  "taskId": "t-04",
  "description": "Draft 3 email variants for VP-level prospects",
  "agent": "EMAIL",
  "dependsOn": ["t-01", "t-03"],
  "inputs": { "segments": "$t-03.output" },
  "estimatedTokens": 1200
}
```

The `dependsOn` field is what gives us **safe parallelism**: tasks with no dependencies run simultaneously; tasks that need upstream outputs wait. A campaign workflow that naïvely takes 12 sequential steps often collapses to 4 parallel waves.

---

### Stage 3 — The Router schedules execution waves

The `Router` receives the DAG and converts it into **execution waves** — groups of tasks whose dependencies are all satisfied. Wave 0 runs first (all root nodes), Wave 1 runs once Wave 0 completes, and so on.

The Router also decides *which worker agent* handles each task and injects tool access based on the `ToolCategory` allow-list for that agent role.

---

### Stage 4 — Workers execute with retry logic

Each worker agent gets one task with its resolved inputs. If a tool call fails:

- **Attempt 1**: Agent adapts, tries an alternative tool
- **Attempt 2**: Exponential backoff, retry same tool
- **Attempt 3**: Mark task `FAILED`, escalate to Verifier

Workers never know they're part of a swarm. They just see a task + allowed tools.

---

### Stage 5 — The Verifier closes the loop

After each task completes, the `Verifier` agent runs a 4-layer hallucination check on the output:

1. Grounding check (is the output supported by actual tool results?)
2. Invented statistics detection
3. Fabricated sources detection
4. Overconfidence detection

If the output fails verification, the task is sent back to the worker with specific feedback — once. If it fails again, the entire workflow enters `AUTO_REPAIR` mode and the Planner re-decomposes that branch.

---

### What I'd love to know from you

- **Where does this break for you?** Are there goal types that produce bad DAGs?
- **What's missing?** Conditional branching ("if lead score > 70, do X, else do Y") is on the roadmap — would that unblock your use case?
- **What industries are you targeting?** We have 12 industry packs but most are lightly tested outside of finance/healthcare.

Drop your thoughts below — everything here is being fed into the v0.6 roadmap.

---

## CONTRIBUTORS.md TEMPLATE

```markdown
# Contributors

Thank you to everyone who has contributed to JAK Swarm. This project exists
because of your time, expertise, and enthusiasm.

---

## Core Team

| Contributor | Role |
|---|---|
| [@inbharatai](https://github.com/inbharatai) | Project founder & maintainer |

---

## Community Contributors

<!-- Add new entries at the top, newest first -->

### [v0.5.x]

| Contributor | Contribution | PR |
|---|---|---|
| [@username](https://github.com/username) | Added Linear integration tools (`linear_create_issue`, `linear_search_issues`) | [#42](https://github.com/inbharatai/jak-swarm/pull/42) |
| [@username](https://github.com/username) | Added unit tests for anti-hallucination pipeline | [#38](https://github.com/inbharatai/jak-swarm/pull/38) |

---

## How to Be Listed Here

Open a PR and your GitHub handle will be added automatically on merge.
We recognise all contributions: code, tests, documentation, bug reports,
and discussion posts that shape the roadmap.

---

## Special Thanks

*For issues, feedback, and design discussions that shaped the architecture:*

- [@username](https://github.com/username) — for surfacing the CRM deduplication edge case
- [@username](https://github.com/username) — for the industry-pack concept
```

---

## RELEASE NOTES DRAFT

### Version v0.5.0 — *Vibe Coding + MCP Expansion*

> **Release date:** April 2026

This is the biggest JAK Swarm release to date. Two headline features land together: the **Vibe Coding engine** that turns plain English (or a screenshot) into a deployed full-stack application, and a **20-provider MCP integration layer** that connects the swarm to the tools your team already uses.

---

#### Headline Features

**Vibe Coding — Build full-stack apps from a sentence**

Five new specialist agents now handle the full app-building lifecycle end-to-end:

| Agent | Responsibility |
|---|---|
| `App Architect` | Generates file tree, component hierarchy, Prisma schema |
| `Code Generator` | Writes React/Next.js/Tailwind source across all layers |
| `Auto-Debugger` | Self-healing error loop — fixes build failures automatically (max 3 retries) |
| `Deployer` | One-click Vercel deploy + GitHub repo sync |
| `Screenshot-to-Code` | Vision-based UI replication from any image |

The Builder UI (`/builder`) ships with Monaco editor, live sandbox preview, and a step-by-step generation timeline.

**MCP Expansion — 20 integration providers**

The Skills Marketplace now surfaces 20 verified MCP providers:

*CRM:* HubSpot, Salesforce, Pipedrive, Zoho CRM, Freshsales  
*Project Management:* Jira, Linear, Asana, ClickUp  
*Collaboration:* Slack, GitHub, Notion  
*Business:* Airtable, Stripe, Google Drive, Discord, Twilio, SendGrid  
*Analytics:* Google Analytics, Supabase

---

#### Improvements

**Developer Experience**
- CI/CD pipeline fully repaired — `@jak-swarm/tools` build order fixed, all packages now build in correct dependency order
- Docker multi-stage build added; `docker compose up` works out of the box
- `pnpm turbo build` completes without errors on a clean clone

**Dashboard & UX**
- Toast notification system replaces all silent errors across 8 dashboard pages — failures are now visible
- `Cmd+K` / `Ctrl+K` global search across agents, tools, and workflows
- Mobile navigation fixed — sidebar and agent network fully responsive
- Skills Marketplace: misleading skill entries replaced with verified, working integrations

**Security & Compliance**
- Legal and Privacy pages added to the dashboard
- Writable system prompt editor in Settings (admin role only)
- Audit log entries now include MCP tool call metadata
- PII detector updated to catch additional structured formats

**Documentation**
- README restructured with Mermaid architecture diagrams
- Vibe Coding pipeline walkthrough added
- All agent/tool count claims normalised to accurate figures

---

#### Bug Fixes

- Fixed number inconsistencies across README badges and feature lists
- Fixed CRM deduplication returning false positives on partial name matches
- Fixed voice agent WebRTC session not cleaning up on tab close
- Fixed scheduler cron entries persisting after workflow deletion

---

#### What's Next (v0.6 Preview)

- Conditional branching in DAG tasks (`if/else` task nodes)
- Linear first-class tool integration (see open issue)
- Temporal workflow persistence for crash-resistant long-running workflows
- Expanded anti-hallucination test coverage
- Public API for triggering workflows via webhook

---

*Full changelog: [github.com/inbharatai/jak-swarm/commits/main](https://github.com/inbharatai/jak-swarm/commits/main)*  
*Report issues: [github.com/inbharatai/jak-swarm/issues](https://github.com/inbharatai/jak-swarm/issues)*
