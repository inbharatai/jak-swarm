# Agent Output Quality Audit (Phase 8)

Verified at commit `c2fb125`. **Static + structural audit only.**
Live behavioral grading requires OPENAI_API_KEY + multi-prompt runs.

---

## 1. Quality discipline built into the system

Even without live grading, JAK has multiple layers that constrain
agent output quality at the SCHEMA + VERIFICATION level:

### 1.1 Structured output enforcement
- `OpenAIRuntime.respondStructured` uses Responses API with
  `text.format.type: 'json_schema'` + `strict: true`
- Each role agent declares a zod schema; LLM cannot return shapes
  outside the schema

### 1.2 Multi-layer hallucination detection (Verifier)
- `packages/agents/src/roles/verifier.agent.ts:46-64` — 4 hallucination
  patterns: unsourced statistics, action-completion claims w/o tool
  evidence, far-future dates, "I have already" phrases without tool
  calls
- Tool-trace cross-check: actions claimed in output must match a
  successful tool call in the trace

### 1.3 Citation density gating (Sprint 2.4/F)
- `verifier.agent.ts` — `computeCitationDensity` for needsGrounding
  agents
- WORKER_RESEARCH threshold: 0.7 (70% of claims must have evidence ref)
- WORKER_DESIGNER threshold: 0.5 (creative slack)
- Verifier surfaces `uncitedClaims[]` and lowers confidence to 0.4 when
  density below threshold

### 1.4 PII redaction (Sprint 2.4/G)
- `RuntimePIIRedactor` in BaseAgent.executeWithTools
- Redact PII before LLM call; restore in trace
- `cost_updated` event surfaces `piiRedacted: { byType, totalMatches }`

### 1.5 Source-grounded contract per role
- `role-manifest.ts` flags which roles produce factual claims
  (need grounding) vs creative output (don't)

### 1.6 Self-correction in worker-node
- `worker-node.ts:107-125` — agent reviews its own output via
  `agent.reflectAndCorrect(...)` before the verifier sees it

### 1.7 Stub rejection at finalOutput
- `apps/api/src/routes/workflows.routes.ts:369-418` — when finalOutput
  matches known stub patterns ("Agents completed their work but did
  not produce..."), the route surfaces real trace content instead

---

## 2. Per-agent quality enablement matrix

| Quality dimension | How JAK enables it |
|---|---|
| Accuracy | Structured zod schema + Verifier 4-layer + needsGrounding citation density |
| Specificity | System prompt rules ("Every recommendation must be SPECIFIC and ACTIONABLE — no vague platitudes") in BaseAgent's `buildSystemMessage` (line 1176) |
| Usefulness | Per-role prompts include domain-specific frameworks (CFO has PE-operator thinking, CTO has FAANG-scale judgment) |
| Source grounding | Sprint 2.4/F citation density check per role |
| Clarity | Structured output forces field-level discipline |
| Completeness | Verifier checks task description vs output |
| Actionability | System prompt rule (line 1176) |
| Formatting | Structured output schemas |
| Overclaim guard | Verifier hallucination layer 4 (action-completion claims) |
| Uncertainty surfacing | "Always state your confidence level" (BaseAgent line 1173) |
| Company-context use | `injectCompanyContext` in BaseAgent (Migration 16) |

✅ **Every quality dimension has at least one structural enabler.**

---

## 3. Test-derived quality evidence

The test suite contains "behavioral" tests for many agents that verify
specific output-shape preservation:

| Test | Asserts |
|---|---|
| `tests/unit/agents/role-behavioral.test.ts` | EmailAgent preserves deliverability + abVariants + sendTimeSuggestion on DRAFT |
| | CRMAgent preserves dealHealth + nextBestAction + duplicateRisk |
| | ResearchAgent preserves source-quality tier + citation map + disagreements |
| | CalendarAgent preserves meeting-type + recommendedSlot + slot-quality score |
| `tests/unit/agents/role-behavioral-extended.test.ts` | AppDeployerAgent preserves buildErrors + envVarsNeeded + rollback + domainStatus |
| `tests/unit/agents/role-strong-tier-behavioral.test.ts` | DesignerAgent preserves components + colorPalette + typography + accessibilityNotes |
| `tests/unit/agents/role-vibe-coder-behavioral.test.ts` | AppArchitectAgent preserves fileTree + dataModels + apiEndpoints + envVars |
| `tests/unit/agents/role-world-class-upgrades.test.ts` | SupportAgent preserves draftResponse + nextActions on DRAFT_RESPONSE |
| `tests/unit/agents/role-exec-behavioral.test.ts` | StrategistAgent preserves recommendations + risks + opportunities + framework |

Each behavioral test stubs `callLLM` with a canned valid response and
asserts that the agent's parser preserves the expert-mode optional
fields end-to-end. **These tests prove SCHEMA fidelity, not narrative
quality.**

✅ Schema-level quality is verified by ~50+ behavioral tests across the suite.

---

## 4. NEEDS RUNTIME — what actually requires live LLM

The following CANNOT be statically graded:

| Quality property | What grading would look like |
|---|---|
| Narrative depth + specificity | 5+ test prompts per agent → human rates outputs against rubric |
| False-claim rate | Same prompts + audit hallucination patterns triggered by Verifier |
| Citation accuracy (does the cited source actually back the claim?) | Manual or LLM-as-judge audit of each citation |
| Cross-agent consistency (CEO vs CMO vs Marketing on same prompt) | Multi-agent trace inspection |
| Output-quality vs cost trade-off | Production runs + cost analytics |

**Estimate:** a credible empirical agent-quality audit would need:
- 200–500 LLM runs across 38 agents × 10–15 prompts
- ~$50–100 in OpenAI token cost
- 4–8 hours of human grading

This is OUT OF SCOPE for this static audit but is the next logical
empirical step.

---

## 5. Honest verdict on output quality

**Static rating: 7.5 / 10.**

Why:
- ✅ Schema discipline is real
- ✅ Verifier hallucination detection is real
- ✅ Citation density gating is real
- ✅ Per-role expert prompts exist
- ✅ 50+ behavioral tests verify schema fidelity
- ⚠️ Live narrative quality unmeasured
- ⚠️ False-claim rate unmeasured
- ⚠️ Citation accuracy unmeasured

The discipline + machinery to PRODUCE high-quality outputs is in place.
**Whether outputs are actually high-quality on real prompts** requires
empirical validation that this static audit cannot provide.

---

## 6. Recommendation

Set up a recurring "agent-quality benchmark" job:
- 10 representative prompts per agent
- Live OpenAI runs once per week
- Verifier outputs (passed, citationDensity, issues) recorded
- Token cost recorded
- Diff against baseline (regressions trigger alert)

Until that exists, agent output quality is **systematically constrained
but empirically unmeasured.**
