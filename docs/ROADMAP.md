# JAK Swarm — Long-Term Vision & Roadmap

> **This is a future roadmap, not a shipped-product claim.** Every "evolving toward" item describes direction. Every "shipped" item links to code you can verify today. If a row says "not yet built" or "evolving," that is the honest status.

---

## Product Sentence

JAK is evolving from a multi-agent workflow operator into an ever-learning Company OS that remembers company context, understands departmental roles, and safely completes approved work across the organisation.

---

## The 5-Layer Model

```mermaid
flowchart TB
    subgraph INPUTS["1. Company Inputs"]
        I1["Calls"]
        I2["Meetings"]
        I3["Docs"]
        I4["Websites"]
        I5["Emails"]
        I6["Code"]
        I7["Tasks"]
        I8["CRM"]
        I9["Support"]
    end

    subgraph MEMORY["2. Company Memory Layer"]
        M1["Transcripts"]
        M2["Decisions"]
        M3["Policies"]
        M4["People"]
        M5["Projects"]
        M6["Risks"]
        M7["Evidence"]
    end

    subgraph INTELLIGENCE["3. Role-Based Intelligence Layer"]
        R1["CEO"]
        R2["HR"]
        R3["CTO"]
        R4["CMO"]
        R5["Finance"]
        R6["Legal"]
        R7["Ops"]
        R8["Support"]
    end

    subgraph PERMISSIONS["4. Permission + Shield Layer"]
        P1["RBAC"]
        P2["Department access"]
        P3["Approval gates"]
        P4["JAK Shield"]
        P5["Audit evidence"]
    end

    subgraph EXECUTION["5. Autonomous Execution Layer"]
        E1["Plan"]
        E2["Assign"]
        E3["Execute"]
        E4["Verify"]
        E5["Report"]
        E6["Learn again"]
    end

    INPUTS --> MEMORY --> INTELLIGENCE --> PERMISSIONS --> EXECUTION
    EXECUTION -->|"feedback loop"| MEMORY
```

---

## Time Horizons

### Short Term — Company Memory Layer

**What:** Transcripts, decisions, policies, people, projects, risks, and evidence extracted from existing connectors (Gmail, Slack, GitHub, Notion) into a persistent, queryable evidence graph.

**Foundation shipped:**

- [`company-operating-layer.service.ts`](apps/api/src/services/company-brain/company-operating-layer.service.ts) — artifact ingestion, entity extraction, drift detection, agent-executable spec generation
- [`company-profile.service.ts`](apps/api/src/services/company-brain/company-profile.service.ts) — LLM-extracted company profiles (industry, brand voice, competitors, goals) approved by the user
- `persistLearning` / `recallLearnings` — per-role memory keyed by tenant, injected into agent context via `<memory>` tags

**Evolving toward:**

- Full auto-sync from all connectors (currently manual ingestion + 7 artifact sources)
- Cross-session grounding (memory that persists and improves across workflows)
- Proactive drift detection (the system tells you what changed, not just answers when asked)

### Medium Term — Role-Based Intelligence + Permission Shield

**What:** Department-aware agent roles (CEO, HR, CTO, CMO, Finance, Legal, Ops, Support) with RBAC-scoped context, approval gates per department, and JAK Shield enforcement at the role boundary.

**Foundation shipped:**

- 38 specialist agents across Executive, Operations, Core, and Vibe Coding layers, each with domain-scoped prompts and tool allowlists
- 13 industry packs with agent prompt supplements, policy overlays, and restricted tool lists
- JAK Shield 6-stage pipeline (Agent Firewall, Risk-Based Approvals, Secure Tool Permissions, Sandboxed Execution, Defensive Vulnerability Triage, Audit Evidence Layer)
- 5-role RBAC (`END_USER`, `REVIEWER`, `OPERATOR`, `TENANT_ADMIN`, `SYSTEM_ADMIN`)

**Evolving toward:**

- Department-scoped RBAC (HR agents see HR context only; Finance agents see Finance context only)
- Per-department approval policies (Finance actions require Finance REVIEWER; Legal actions require Legal REVIEWER)
- JAK Shield enforcement at the role boundary (department-isolated tool access)

### Long Term — Autonomous Execution Layer

**What:** Plan, assign, execute, verify, report, learn again — a closed loop where approved work completes across the organisation and the system improves from each cycle.

**Foundation shipped:**

- Commander → Planner → Router → Worker → Verifier loop with auto-repair
- Risk-tiered approval gates with SHA-256 payload binding
- HMAC-signed audit evidence bundles
- Self-correction: `reflectAndCorrect()` + `RepairService` with 9 error categories

**Evolving toward:**

- Self-improving cycles (the system learns from completed workflows and adjusts future plans without human re-specification)
- Cross-workflow learning (insights from one department's work inform another)
- Proactive task assignment (the system identifies work that needs doing, rather than waiting for a prompt)

---

## Honest Boundaries

This section explicitly states what the roadmap does **not** claim:

- **"Company OS" is a direction, not a shipped product.** The beta ships a closed-loop operating layer for product and engineering execution. The full Company OS vision requires auto-sync, department-scoped RBAC, and autonomous learning cycles that are not yet built.
- **Auto-sync is a product build item.** Full connector auto-sync (all inputs flowing automatically into the evidence graph) does not exist today. The `company-operating-layer.service.ts` pipeline exists for manual ingestion.
- **Department-scoped RBAC does not exist.** The current 5-role RBAC is tenant-scoped, not department-scoped. Adding department boundaries requires schema changes, migration, and UI work.
- **Self-improving cycles are not built.** Agent memory (`persistLearning` / `recallLearnings`) persists facts across workflows. It does not yet adjust future plans without human re-specification.
- **Third-party SOC 2 / HIPAA / ISO 27001 attestation has not happened.** The infrastructure is shipped (182 controls, 108 operationally backed). The certification audit has not.

These boundaries mirror the "Honest boundary" subsection in the README and the "What Is Not Yet Enterprise-Ready" section in [`docs/beta-release.md`](beta-release.md).

---

## Related Documentation

- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — system architecture and data model
- [`docs/beta-release.md`](beta-release.md) — beta scope and go/no-go checklist
- [`docs/competitive-positioning.md`](competitive-positioning.md) — market positioning
- [`docs/jak-shield-manifest.md`](jak-shield-manifest.md) — JAK Shield 6 defenses