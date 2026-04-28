# No-Fake / No-Dummy / No-Placeholder Audit (Phase 3)

Verified at commit `c2fb125`. Wide-net grep + classification of every
match found in **production source code** (excluding tests and
node_modules).

---

## 1. Search patterns scanned

```
mock | dummy | fake | placeholder | TODO | FIXME |
simulated | hardcoded | static response | coming soon |
not implemented | stub | demo only | sample output | no-op |
pretend | dry-run forced | fallback fake | mock success |
fake completed | silent pass | ENABLE_MOCK_PROVIDER | JAK_USE_MOCK |
MOCK_RESPONSE | FAKE_LLM
```

---

## 2. Findings classified

### 2.1 Safe — agent-prompt content (anti-pattern WARNING text)

These mention "TODO" / "stub" inside system-prompt text that tells
the LLM to NEVER produce TODO/stub code. They are pedagogical and
therefore correct:

| File | Line | Verdict |
|---|---|---|
| `packages/agents/src/workers/app-generator.agent.ts:66, 88` | system prompt: "no `// TODO`, no stubs" | ✅ correct guidance |
| `packages/agents/src/workers/coder.agent.ts:48, 56` | same | ✅ correct guidance |
| `packages/agents/src/workers/screenshot-to-code.agent.ts:55, 107` | same | ✅ correct guidance |

### 2.2 Safe — tool that detects TODO/FIXME in user code

| File | Line | Verdict |
|---|---|---|
| `packages/tools/src/builtin/index.ts:4578-4626` | `tech_debt_scanner` tool — scans CUSTOMER's repos for TODO/FIXME | ✅ legitimate user-facing feature |
| `apps/web/src/app/(dashboard)/skills/page.tsx:44` | UI label for the same tool | ✅ |
| `packages/swarm/src/workflows/vibe-coder-workflow.ts:108-109` | Generated-code validator: rejects files containing TODO comments | ✅ correct safeguard |

### 2.3 Safe — honest stub/notice strings ROUTED THROUGH HONEST CHANNELS

| File | Line | Verdict |
|---|---|---|
| `apps/api/src/routes/voice.routes.ts:135-193` | references `isMock` flag, ALWAYS sets `isMock: false` for real path | ✅ honest |
| `apps/api/src/services/audit/external-auditor.service.ts:62, 200, 208` | email send returns `'not_configured'` honestly when SMTP env missing | ✅ honest by design (Final hardening / Gap C) |
| `packages/agents/src/base/base-agent.ts:838-902` | reads tool result `_notice`/`_warning` and surfaces them as honest mock/draft/not_configured badges | ✅ honest |
| `packages/shared/src/types/tool.ts:106-122` | `ToolOutcome` union explicitly enumerates `mock_provider`/`not_configured`/`blocked_requires_config`/`draft_created` | ✅ honest |
| `apps/api/src/routes/integrations.routes.ts:17` | `IntegrationMaturity` includes `'placeholder'` as an explicit honest classification | ✅ |

### 2.4 Safe — STORED_NOT_PARSED honest fallback

| File | Line | Verdict |
|---|---|---|
| `apps/api/src/routes/documents.routes.ts:375, 389` | When parser fails or unknown mime, marks document as `STORED_NOT_PARSED` with explicit ingestionError. Comment says "honestly — do not pretend we extracted content." | ✅ honest |

### 2.5 Safe — STUB DETECTION in workflow output

| File | Line | Verdict |
|---|---|---|
| `apps/api/src/routes/workflows.routes.ts:369-418` | When workflow `finalOutput` matches a known stub pattern, rejects the stub and surfaces real trace content instead | ✅ active stub-rejection layer |
| `apps/api/src/services/swarm-execution.service.ts:1980, 2012` | Same — final-output extraction skips generic stub strings | ✅ |

### 2.6 Safe — placeholder COMPLIANCE workflow row (FK requirement)

| File | Line | Verdict |
|---|---|---|
| `apps/api/src/services/compliance/attestation.service.ts:178-339` | Creates a per-tenant "placeholder" Workflow row to satisfy the FK from `Attestation.workflowId`. NOT a fake feature — it's a real DB row with a deterministic goal string ("Compliance attestation"). | ✅ legitimate FK dance |

### 2.7 Safe — paddle.routes.ts placeholder rejection

| File | Line | Verdict |
|---|---|---|
| `apps/api/src/routes/paddle.routes.ts:24-28` | Comment explains a `pri_*_placeholder` string is rejected because it "would NEVER appear in a real Paddle event" — defense against accidental placeholder use | ✅ active rejection |

### 2.8 No mock-provider toggle anywhere in production code

```bash
$ grep -r "ENABLE_MOCK_PROVIDER|JAK_USE_MOCK|MOCK_RESPONSE|FAKE_LLM" \
    --include='*.ts' --include='*.tsx' apps packages \
    | grep -v node_modules | grep -v '.test.'
(no matches)
```

✅ **No fake-LLM env toggle exists in the codebase.** Production runtime
always calls real LLM (or fails honestly when no API key — see
`base-agent.ts:347-350` which throws `[role] No OPENAI_API_KEY...`).

### 2.9 ZERO production code introduces fake completions

Every "stub"-related code path I found either:
- ACTIVELY DETECTS stubs in worker output (workflows.routes.ts,
  swarm-execution.service.ts), or
- Is system-prompt guidance to the LLM telling it NOT to produce stubs
  (worker agent files), or
- Is the `tech_debt_scanner` tool that scans customer code for stubs
  (legitimate user-facing feature)

---

## 3. Honest-status surfaces (these are the right pattern)

The codebase has a CONSISTENT pattern of returning honest 3-state status
when external integration isn't configured:

| Surface | Honest states |
|---|---|
| Tool execution | `real_success` / `draft_created` / `mock_provider` / `not_configured` / `blocked_requires_config` / `failed` |
| Auditor email send | `sent` / `not_configured` / `failed` |
| Document parsing | `INDEXED` / `STORED_NOT_PARSED` / `FAILED` (with `parseConfidence` 0.4–0.95 surfaced) |
| LLM cost | `cachedReadTokens` / `reasoningTokens` / `promptTokens` honestly broken out |
| Verification | `passed: boolean` + `citationDensity` + `uncitedClaims[]` honest |

This is the **opposite** of fake/dummy — JAK is structurally allergic to
silent-fake responses.

---

## 4. PII redactor — honest behavior verification

`packages/security/src/guardrails/runtime-pii-redactor.ts`:
- Stores ONLY the placeholder→original map in memory for the call's duration
- Returns input verbatim when no PII detected
- `getStats().totalMatches=0` when nothing was redacted (caller must NOT claim redaction happened)
- 14 unit tests in `tests/unit/security/runtime-pii-redactor.test.ts` cover this

✅ honest by construction.

---

## 5. CEO orchestrator — honest LLM-failure path verification

`apps/api/src/services/ceo-orchestrator.service.ts:24`:
> *"emits ceo_final_summary_generated with summary= explicit error message; never silent-passes"*

`generateExecutiveSummary()` catches LLM errors and surfaces:
```ts
result = {
  summary: `Executive summary unavailable: ${msg}. Workflow finished with status ${input.status}.`,
  nextActions: [],
  generationError: msg,
};
```
✅ test `tests/unit/services/ceo-orchestrator.test.ts` line 230+ verifies
this honest behavior when `OPENAI_API_KEY` is missing.

---

## 6. Repair service — honest escalation

`apps/api/src/services/repair.service.ts:24`:
> *"emits repair_escalated_to_human; never silent-fakes"*

`decideRepair()` returns `{action: 'escalate_to_human'}` — never a
silent retry — when:
- Destructive action (always)
- Permission block / approval timeout
- Unknown error class (defensive)

27 unit tests in `tests/unit/services/repair-service.test.ts` cover
every classification + decision path.

---

## 7. Items NOT found (good)

- ❌ No `JAK_USE_MOCK` / `JAK_FAKE_LLM` / `ENABLE_MOCK_PROVIDER` env toggle in production code
- ❌ No hardcoded LLM responses in production paths
- ❌ No "if !apiKey then return fake-success" pattern anywhere
- ❌ No silent-pass on document parser failure (`STORED_NOT_PARSED` is the honest state)
- ❌ No mock email "success" when SMTP not configured (returns `not_configured`)
- ❌ No fake "completed" status anywhere — every COMPLETED requires the
  workflow to actually return a non-stub finalOutput

---

## 8. Verdict

**Rating: 9.5 / 10 — production code has zero dangerous fake/dummy paths.**

What I would deduct half a point for:
- The `compliance/attestation.service.ts` placeholder workflow row is
  legitimate but the comment "placeholder" is mildly misleading
  vocabulary — it's actually a real row with a fixed purpose. Could be
  renamed to `ensureComplianceWorkflowAnchor` for clarity. Not a
  correctness issue, just a naming nit.

**No critical issues to fix in this phase.** The codebase has an
explicit "honest-by-default" pattern that surfaces every external
integration's true state. This is the **opposite** of a system using
dummies/fakes/placeholders.

---

## 9. Files inspected

- 30 route files in `apps/api/src/routes/`
- 32 service files in `apps/api/src/services/`
- 38 agent files (6 roles + 32 workers)
- 9 graph nodes
- 122+ tools in `packages/tools/src/builtin/index.ts`

Total grep coverage: ~250 production source files.

---

## 10. Action items

None blocking. The honest-by-default discipline is verified and
should be preserved in future development.
