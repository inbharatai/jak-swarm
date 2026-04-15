# AUDIT V7: Truth Audit + Minimal Agent Arcade Adoption

Date: 2026-04-15
Scope: JAK Swarm architecture reality check, DAG/visualization truth, WhatsApp truth, provider inventory, and selective Agent Arcade reuse strategy.

## Executive decision

Adopt only the minimum useful structure from Agent Arcade (visualization interaction patterns and replay UX ideas) and do NOT integrate the full gateway stack.

Why:
- JAK already has a real execution engine and live event stream.
- Full gateway integration would increase complexity, operational surface, and maintenance burden.
- The current gap is mostly UX fidelity (execution playback and intervention ergonomics), not core orchestration.

## What is real in JAK today

- Real swarm graph runner and state transitions: packages/swarm/src/graph/swarm-graph.ts
- Real dependency scheduling and cycle handling: packages/swarm/src/graph/task-scheduler.ts
- Real runtime controls and execution orchestration path: apps/api/src/routes/workflows.routes.ts, apps/api/src/services/swarm-execution.service.ts, packages/swarm/src/runner/swarm-runner.ts
- Real live stream consumer in UI: apps/web/src/hooks/useWorkflowStream.ts:16
- Real dashboard wiring to graph + stream + tracker: apps/web/src/components/workspace/WorkspaceDashboard.tsx:115
- Real DAG and tracker components (lightweight): apps/web/src/components/graph/WorkflowDAG.tsx:36, apps/web/src/components/workspace/AgentTracker.tsx:40

## What is partial or simplified

- Timeline criticalPath is not a full DAG longest-path algorithm; it is derived from node duration ordering: apps/api/src/services/workflow-timeline.service.ts:132
- Visualization is plan-oriented + stream updates, not a full deterministic replay debugger: apps/web/src/components/graph/WorkflowDAG.tsx:36, apps/web/src/components/workspace/AgentTracker.tsx:40

## What is absent

- No source-level Agent Arcade integration found in apps/packages/docs search (no gateway/replay ingestion bridge references).
- No source-level WhatsApp control surface found in runtime app paths.
- Twilio appears as landing page ecosystem label only: apps/web/src/app/page.tsx:758

## Providers and legacy inventory truth

DeepSeek and Ollama are still present as active code/config surfaces, not only stale docs.

Evidence:
- Provider list includes deepseek/ollama: apps/api/src/routes/llm-settings.routes.ts:48
- Config includes DeepSeek/Ollama env handling: apps/api/src/config.ts, apps/api/src/boot/validate-config.ts
- Routing/optimizer/pricing/test surfaces include these providers: packages/agents/src/base/provider-router.ts, packages/agents/src/base/token-optimizer.ts, packages/shared/src/constants/llm-pricing.ts, tests/integration/full-pipeline.test.ts

## Runtime checks (targeted)

Command executed: node tests/human-simulator/run-all.js

Observed outcome:
- 78/80 checks passed (98%).
- 2 failures:
  - verify_email tool input validation (missing required field content)
  - auto_engage_reddit timeout (60s)
- Multiple OpenAI 429 insufficient_quota warnings/errors were observed during the run. The suite continued and still completed with high pass rate.

Interpretation:
- System behavior is mostly functional end-to-end.
- Remaining failures are specific and fixable, not systemic architecture breakage.

## Minimal Agent Arcade reuse plan (recommended)

Phase 1 (safe, low weight)
- Improve existing graph and tracker UX only:
  - Add deterministic event timeline scrubber over existing trace events.
  - Add step-focused diff view (inputs/outputs/tools/errors) per node.
  - Keep current JAK APIs and storage model unchanged.

Phase 2 (optional, still lightweight)
- Add replay session abstraction on top of existing trace payloads:
  - Build a replay controller in web only.
  - No external gateway service.
  - No new ingestion protocol.

Phase 3 (only if proven needed)
- Evaluate selective adapter extraction for interoperability.
- Avoid full Agent Arcade runtime embedding unless required by a concrete product requirement.

## Safe fixes to apply next (small and focused)

1) Fix verify_email tool contract mismatch in human simulator fixture/input.
2) Stabilize auto_engage_reddit timeout path (retry/backoff and deterministic timeout budget in test harness).
3) Decide and enforce provider policy:
- If DeepSeek/Ollama are out of policy, remove from router/config/ui/pricing/tests/docs in one coordinated cleanup.

## Final conclusion

JAK should stay clean and simple:
- Keep JAK execution core as the source of truth.
- Borrow only visualization and replay interaction ideas from Agent Arcade.
- Do not integrate the full Agent Arcade stack unless a hard requirement appears.
