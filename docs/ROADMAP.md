# JAK Swarm — Long-Term Vision & Roadmap

> **This is a future roadmap, not a shipped-product claim.** Every "evolving toward" item describes direction. Every "shipped" item links to code you can verify today. If a row says "not yet built" or "evolving," that is the honest status.

---

## Product Sentence

JAK Swarm is the ever-learning Company OS. JAK Shield is the MCP-native trust gateway that protects every real-world agent action.

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

    subgraph PERMISSIONS["4. Permission + Governance Layer"]
        P1["RBAC"]
        P2["Department access"]
        P3["Approval gates"]
        P4["Agent Governance Overlay"]
        P5["JAK Shield MCP"]
        P6["Audit evidence"]
        P7["Autonomy Ladder"]
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

### Medium Term — Role-Based Intelligence + Permission Governance

**What:** Department-aware agent roles (CEO, HR, CTO, CMO, Finance, Legal, Ops, Support) with RBAC-scoped context, Ability Packs, Autonomy Ladder (L0–L4 with local policy; L5 deferred), Agent Governance Overlay enforcing agent profiles and memory scopes.

**Foundation shipped:**

- 38 specialist agents across Executive, Operations, Core, and Vibe Coding layers, each with domain-scoped prompts and tool allowlists
- 13 industry packs with agent prompt supplements, policy overlays, and restricted tool lists
- Local policy logic in `packages/security`: Agent Firewall, Risk-Based Approvals, Secure Tool Permissions, Sandboxed Execution, Defensive Vulnerability Triage, Audit Evidence Layer — **all 6 defenses are wired and enforced on every agent action today**
- JAK Shield is a separate MCP-native 10-stage security gateway ([github.com/inbharatai/jak-shield](https://github.com/inbharatai/jak-shield)) — the MCP call to this external service is Phase 11B; local policy enforcement is active now
- 5-role RBAC (`END_USER`, `REVIEWER`, `OPERATOR`, `TENANT_ADMIN`, `SYSTEM_ADMIN`)

**Evolving toward:**

- Department-scoped RBAC (HR agents see HR context only; Finance agents see Finance context only)
- Per-department approval policies (Finance actions require Finance REVIEWER; Legal actions require Legal REVIEWER)
- Agent Governance Overlay enforcing profiles, scopes, and role boundaries — **the autonomy-policy + governance-gate core is built** (HyperAgent Phases 1 + 7, `packages/security` governance); the **external JAK Shield MCP transport** call remains a roadmap item (Phase 11B+)
- Ability Packs (department-scoped tool, memory, and approval configurations) — roadmap item
- Autonomy Ladder — **the L0-L5 capability matrix + fixed human-only NEVER set is built** as a central deterministic policy (HyperAgent Phase 1); L5 `CODE_PATCH_BRANCH` is in the matrix and gated to an isolated branch + draft PR only (Phase 12)

### Long Term — Autonomous Execution Layer

**What:** Plan, assign, execute, verify, report, learn again — a closed loop where approved work completes across the organisation and the system improves from each cycle.

**Foundation shipped:**

- Commander → Planner → Router → Worker → Verifier loop with auto-repair
- Risk-tiered approval gates with SHA-256 payload binding
- HMAC-signed audit evidence bundles
- Self-correction: `reflectAndCorrect()` + `RepairService` with 9 error categories
- **HyperAgent self-healing + self-learning layer** (Phases 0-14, `feature/hyperagent-self-healing-learning`): deterministic 20-class failure classifier → counterfactual diagnosis → symbolic replanner + validator → autonomy-gated apply; information-theoretic learning gate; versioned-config lifecycle (shadow/canary/promote/rollback); R5 code self-repair (isolated branch + draft PR only); honest Control Centre (9 views). Integration tests prove real plan repair, learning promotion, Shield fail-closed, and rollback end-to-end.

**Evolving toward:**

- Self-improving cycles in a **live production run** — the pure-core learning/replan layer is built and integration-proven; *measured learning impact in production* (12-step E2E + Cloud Run deploy gate) is env-blocked and not fake-passed
- Cross-workflow learning (insights from one department's work inform another)
- Proactive task assignment (the system identifies work that needs doing, rather than waiting for a prompt)

### JAK Shield MCP Integration Timeline

**Phase 1-11A:** All security enforcement uses local policy logic in `packages/security` — Agent Firewall, Risk-Based Approvals, Secure Tool Permissions, Sandboxed Execution, Defensive Vulnerability Triage, and Audit Evidence Layer are all wired and active. JAK Shield MCP exists as a separate 10-stage product at [github.com/inbharatai/jak-shield](https://github.com/inbharatai/jak-shield); the MCP call from JAK Swarm to that external service is not yet wired (Phase 11B).

**Phase 11B:** Wire JAK Shield MCP for high-risk action validation. The `ShieldMcpClient` (local embedded mode: signs + verifies decisions with a tenant key pair, fail-closed when unavailable/unverified) and the `AgentGovernanceOverlay` autonomy/governance core are **built** (HyperAgent Phases 7-8). What remains is the **MCP transport** call from JAK Swarm to the external JAK Shield service and persisting those decisions in AuditLog with HMAC signatures.

**Phase 11B+:** JAK Shield MCP provides additional security layer for high-risk actions. If JAK Shield MCP unavailable, fall back to local policy + require approval.

---

## Honest Boundaries

This section explicitly states what the roadmap does **not** claim:

- **"Company OS" is a direction, not a shipped product.** The beta ships a closed-loop operating layer for product and engineering execution. The full Company OS vision requires auto-sync, department-scoped RBAC, and autonomous learning cycles that are not yet built.
- **Auto-sync is a product build item.** Full connector auto-sync (all inputs flowing automatically into the evidence graph) does not exist today. The `company-operating-layer.service.ts` pipeline exists for manual ingestion.
- **Department-scoped RBAC does not exist.** The current 5-role RBAC is tenant-scoped, not department-scoped. Adding department boundaries requires schema changes, migration, and UI work.
- **Self-improving cycles — pure-core layer built, live impact not yet measured.** The HyperAgent self-learning pipeline (Phase 5: information-theoretic learning gate, Bayesian evidence accrual, hazard-model expiry) + outcome evaluator (Phase 3) + symbolic replanner (Phase 4) are built and proven by integration tests at the pure-core layer. Agent memory (`persistLearning` / `recallLearnings`) persists facts across workflows. What is **not** yet proven is *measured learning impact in a live production run* — the 12-step E2E + Cloud Run deploy gate that would prove a promoted learning improves a future run's outcome is env-blocked (no live stack) and is not fake-passed.
- **Agent Governance Overlay — autonomy + governance core built, full overlay evolving.** The central autonomy policy (L0-L5 matrix + human-only NEVER set, Phase 1) and the governance gate (Phase 7) are built. The full overlay (agent profiles, memory scopes, department-scoped boundaries) remains a roadmap item. See [`docs/EVOLUTION-PLAN.md`](EVOLUTION-PLAN.md) for the phased implementation plan.
- **JAK Shield MCP transport is not yet wired.** JAK Shield is a separate 10-stage MCP-native gateway at [github.com/inbharatai/jak-shield](https://github.com/inbharatai/jak-shield). The `ShieldMcpClient` (local embedded signed-decision mode, Phase 8) and `AgentGovernanceOverlay` core are built; what is **not** wired is the MCP **transport** call to the external JAK Shield service for signed high-risk decisions. **Today, JAK Swarm's 6 local policy defenses in `packages/security` are fully wired and enforced on every agent action**, plus the local signed-decision path.
- **Ability Packs are not built.** Department-scoped tool/memory/approval configurations remain a roadmap item. The Autonomy Ladder (L0-L5) **is** built (HyperAgent Phase 1).
- **Third-party SOC 2 / HIPAA / ISO 27001 attestation has not happened.** The infrastructure is shipped (182 controls, 108 operationally backed). The certification audit has not.

These boundaries mirror the "Honest boundary" subsection in the README and the "What Is Not Yet Enterprise-Ready" section in [`docs/beta-release.md`](beta-release.md).

---

## Related Documentation

- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — system architecture and data model
- [`docs/beta-release.md`](beta-release.md) — beta scope and go/no-go checklist
- [`docs/competitive-positioning.md`](competitive-positioning.md) — market positioning
- [`docs/jak-shield-manifest.md`](jak-shield-manifest.md) — Local policy defenses (JAK Shield is a separate 10-stage MCP gateway at [github.com/inbharatai/jak-shield](https://github.com/inbharatai/jak-shield))
- [`docs/EVOLUTION-PLAN.md`](EVOLUTION-PLAN.md) — Full next-evolution architecture including JAK Shield MCP integration and Agent Governance Overlay