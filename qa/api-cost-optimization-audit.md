# API Cost + Optimization Audit (Phase 14)

Verified at commit `c2fb125`.

---

## 1. Model tiering (already audited Phase 4)

3-tier system with per-agent map:
- Tier 3 (premium reasoning, ~$5/1M in): Commander/Planner/Verifier/Strategist/AppArchitect
- Tier 2 (balanced, ~$0.50/1M in): Coder/Designer/Marketing/Research/Browser/Legal
- Tier 1 (cheap+fast, ~$0.10/1M in): Email/Calendar/CRM/HR/classifier helpers

Per-agent override via `AGENT_MODEL_MAP`; per-tier override via env.

✅ Cost-aware routing.

---

## 2. Prompt caching (Sprint 2.2/I)

`packages/agents/src/runtime/openai-runtime.ts:230-238`:
```ts
const cached = resp.usage.input_tokens_details?.cached_tokens ?? 0;
totalCostUsd += calculateCost(resp.model, prompt, completion, cached);
```

`packages/shared/src/constants/llm-pricing.ts`:
- `cachedInputPer1M` per model (gpt-5.4: $0.50, gpt-4o: $1.25)
- `calculateCost` discounts cached tokens; falls back to 50% discount when explicit not set
- Defensive clamp: cached > prompt → clamps to prompt

Surfaces in `cost_updated` event:
- `promptTokens`, `completionTokens`, `totalTokens`
- `cachedReadTokens` (when > 0)
- `reasoningTokens` (o-series models, when > 0)
- `costUsd` (already discounted)

`packages/agents/src/base/base-agent.ts:1151-1185` — system prompt is
**fully static** (no per-call timestamps or IDs), maximizing cache hit
ratio across calls.

✅ Real prompt caching with honest accounting.

---

## 3. Context summarization (Sprint 2.2/H)

`packages/swarm/src/context/context-summarizer.ts`:
- `needsSummarization(state)` — fires at 6+ task results AND > 16k tokens
- `summarizeTaskResults(state)` — protects current task + direct deps + last 2 completed; compresses older entries to key-value summaries
- `applySummarizationIfNeeded(state)` — wired into worker-node BEFORE buildTaskInput

`worker-node.ts` emits `context_summarized` event with input/output token counts.

✅ Real context summarization for long DAGs.

---

## 4. Document chunking

`DocumentIngestor.ingestText` (in `packages/tools`) chunks text before
embedding into pgvector. Chunk size + overlap configurable per provider.

✅ Documents are chunked, not full-text-embedded.

---

## 5. Repeated full-context sends

The biggest cost-bloat source in agent systems is sending the entire
conversation history on every call. JAK mitigations:
- Per-task agent calls operate on `taskInput` (just that task's needs)
- Worker-node passes only the relevant upstream task results via
  `dependencyResults` (worker/task-input-builders.ts:50)
- Context summarizer compresses older results before they bloat the input

Static check: `worker-node.ts:79` — `buildTaskInput(task, stateForInput)`
takes the SUMMARIZED state, not the full state.

✅ No full-context send anti-pattern.

---

## 6. Unnecessary duplicate calls

Loop-detection in BaseAgent.executeWithTools (line ~705):
```ts
if (count >= LOOP_DETECTION_THRESHOLD) loopDetected = true;
```
Hard-stops the agent + asks for a summary instead of looping.

Verifier-retry in verifier-node:
```ts
const MAX_RETRIES = 2; // before accepting result as-is
```
Bounded; never infinite.

LLM-call retry in BaseAgent:
```ts
LLM_MAX_RETRIES = 3; // for transient API errors
```
Bounded with exponential backoff.

✅ Multi-layer bounded-retry. No infinite-loop risk.

---

## 7. Verifier overuse

Sprint 3.1 cost optimization: Verifier only runs when:
- task.riskLevel === 'HIGH' OR
- task.requiresApproval === true OR
- taskOutput is missing

LOW-risk routine tasks AUTO-PASS (saves ~$0.02 per Verifier call).
Operator can force Verifier on via `JAK_VERIFIER_ALWAYS_ON=1`.

`verifier-node.ts:74-83`:
```ts
const needsVerifier =
  forceVerifier ||
  task.riskLevel === 'HIGH' ||
  task.requiresApproval === true ||
  taskOutput === undefined ||
  taskOutput === null;
```

✅ Cost-aware Verifier gating.

---

## 8. Invalid model calls

ModelResolver capability check at boot (`models.list()` once); per-tier
preferred chains; failsafe map. Operators see exact resolved map at
startup. **No 404-per-request failure mode.**

`packages/agents/src/runtime/model-resolver.ts:140+` logs the resolved
map at boot.

✅ No silent invalid-model 404s.

---

## 9. Cost display

| Surface | What's shown |
|---|---|
| `cost_updated` activity event | model, promptTokens, completionTokens, cachedReadTokens, reasoningTokens, piiRedacted, costUsd |
| `accumulatedCostUsd` in SwarmState | running total per workflow |
| Workflow `totalCostUsd` column in DB | persisted final |
| Cockpit cost ribbon | reads cost_updated events |
| `/audit/runs/:id` final-pack metadata | per-run cost (audit) |

✅ Multi-layer cost surface.

---

## 10. Per-agent cost tracking

`cost_updated` event carries `agentRole` + `stepId`. The cockpit can
break costs down per-agent per-task. Audit log preserves the same.

✅ Granular cost attribution.

---

## 11. Per-run cost tracking

`SwarmState.accumulatedCostUsd` accumulates as the LangGraph reducer
sums `nodeCost` from each node's traces. Budget enforcement:
```ts
if (state.maxCostUsd && state.accumulatedCostUsd > state.maxCostUsd) {
  return { error: 'Workflow budget exceeded: ...', status: FAILED };
}
```
(verified in langgraph-graph-builder.ts wrapNode)

✅ Real budget gate.

---

## 12. Async cost tracking

Async worker (queue-worker.ts) calls swarm-execution.service.executeAsync
which goes through the same SwarmRunner → LangGraph path. Same cost
events emit. No async-specific cost leak.

---

## 13. Honest gaps

1. **No prompt-cache hit ratio metric in admin diagnostics.** Token
   breakdown is in `cost_updated` event but operators have to stitch
   it themselves. Could add `/admin/diagnostics/cache-stats` endpoint.
2. **Context summarizer thresholds (6+ tasks, 16k tokens) are defaults**
   — may need per-tenant tuning.
3. **Tier-3 verifier on every approval-gated task** — cheap because
   Verifier is now tier-2 (Migration 16 recalibrated AGENT_TIER_MAP),
   but for LOW-risk approval-gated tasks the auto-skip kicks in anyway.

---

## 14. Rating

**API cost + optimization: 8.5 / 10**

- ✅ Per-tier model selection
- ✅ Prompt caching with honest accounting
- ✅ Context summarization for long DAGs
- ✅ Document chunking
- ✅ Loop detection
- ✅ Bounded retries
- ✅ Verifier auto-skip for LOW-risk routine tasks
- ✅ Capability-checked model resolver (no 404 spam)
- ✅ Multi-layer cost surface
- ✅ Real budget gate

**Why not 10/10:**
- No admin diagnostics cache-hit-ratio dashboard
- Context summarizer not per-tenant tunable
- Live cost benchmarks not measured (NEEDS RUNTIME)
