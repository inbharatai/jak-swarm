# OpenAI-first runtime — live verification

**Date:** 2026-04-25
**Method:** `/version` endpoint + static trace + a real `pnpm bench:runtime` execution against the configured OpenAI key, with the new quota-aware classification.

## Live run result (post quota classification)

`pnpm bench:runtime` was re-executed in this hardening pass after the new `OPENAI_QUOTA_EXHAUSTED` classification landed:

```
──────── Summary ────────
  openai-responses     0/4 pass (0%) · quota-blocked 4 · real fails 0 · p50 18487ms · p95 19077ms · $0.0000

[bench-runtime] BLOCKED: all failures are OPENAI_QUOTA_EXHAUSTED or OPENAI_RATE_LIMITED.
                Top up at platform.openai.com/billing and re-run.
exit code 2  (BLOCKED, not failed)
```

**Honest interpretation:** the harness reached the OpenAI API. The API rejected the calls with HTTP 429 quota exhaustion. The bench classified all 4 failures as `OPENAI_QUOTA_EXHAUSTED`. Exit code 2 means "blocked by external billing condition, not a code regression". CI workflow treats this as a `::warning::`, not a failure.

## Verdict matrix

Status legend:
- **statically verified** — code path traced; tests pass
- **live verified** — real call landed AND the call's content was observed
- **live reached, blocked** — real call landed; provider declined for non-code reasons (quota, billing)
- **not verified** — neither static nor live evidence
- **failed** — a real attempt was made and failed for a code reason

| Capability | Verdict |
|---|---|
| OpenAI runtime path resolves correctly | **statically verified** |
| API key is present + reaches OpenAI | **live verified** (the 429 is a real API response — the request shape, auth, and TLS path all work) |
| Quota / billing state allows model calls | **live reached, blocked** (gate: top up account) |
| Model resolver picks a real model | **statically verified** (cannot live-verify content without quota) |
| Gemini / Anthropic NOT in critical path | **statically verified** (`provider-router.ts:286-296` returns OpenAIProvider first whenever key is set) |
| Backend lifecycle events emit | **statically verified + tested** (5 integration tests, full coverage matrix) |
| Cockpit renders events during a live run | **not verified** (would require a browser session with quota) |
| Tool outcomes shown honestly | **statically verified + tested** (ToolOutcome enum end-to-end) |
| Token / cost telemetry complete | **statically verified** (cost_updated event carries runtime, model, fallback, tokens, runId, stepId) |
| Lifecycle assertion strict mode | **statically verified + tested** (32 tests, both modes) |
| Approval round-trip lifecycle | **statically verified + tested** (5 integration tests) |
| Artifact storage gate (REQUIRES_APPROVAL) | **statically verified + tested** (7 schema-failsafe tests + service-level approval gate) |
| Export converters produce real bytes | **statically verified + tested** (15 tests including magic-byte verification) |
| Bundle signing detects tampering | **statically verified + tested** (18 tests covering all tamper vectors) |

## Exact commands to run after quota top-up

```bash
# 1. Re-run the bench scenarios
pnpm bench:runtime              # 4 LLM scenarios — workflow_planning, research, CMO, vibecoder
pnpm bench:runtime -- --core    # alternative: 7 persona-core scenarios
```

After the bench succeeds, the `qa/benchmark-results-openai-first.md` file will be overwritten with real pass/fail numbers.

```bash
# 2. Run the cockpit-visibility check manually (browser required)
pnpm dev                        # boot apps/api + apps/web

# In a browser at http://localhost:3000/workspace:
#   a) Send: "hi"
#      → confirm chat replies + cockpit shows 1 LLM call + cost > 0
#   b) Send: "Write a 200-word LinkedIn post for JAK Swarm enterprise launch"
#      → confirm right drawer shows: status badge, plan with 1 step,
#        worker_started → worker_completed flips, cost footer shows
#        runtime + model + fallback (if any)
#   c) Send: "Send an email to test@example.com saying hello"
#      → confirm: paused event arrives, status badge flips to AWAITING_APPROVAL,
#        approval link appears in chat
#   d) Approve via /approvals UI
#      → confirm workflow continues to COMPLETED with completed tasks NOT re-run

# 3. Run the new export + bundle smoke tests (requires running API + auth)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"kind":"workflow_report","format":"pdf","markFinal":true}' \
  http://localhost:4000/workflows/$WORKFLOW_ID/export
# → returns artifactId + status=READY + approvalState=REQUIRES_APPROVAL

curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/artifacts/$ARTIFACT_ID/download
# → returns 403 ARTIFACT_GATED_REQUIRES_APPROVAL (gate working)

curl -X POST -H "Authorization: Bearer $REVIEWER_TOKEN" \
  http://localhost:4000/artifacts/$ARTIFACT_ID/approve
# → returns artifact with approvalState=APPROVED

curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/artifacts/$ARTIFACT_ID/download
# → returns signed Supabase URL (gate satisfied)

# 4. Bundle a workflow's artifacts into a signed evidence pack
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"metadata":{"controlFramework":"SOC2"}}' \
  http://localhost:4000/workflows/$WORKFLOW_ID/bundle
# → returns artifactId + manifest + signature + signatureAlgo

curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/artifacts/$BUNDLE_ID/verify
# → returns {valid: true} (or {valid: false, reason: ...} on tamper)
```

## What's still NOT verified (and why)

- **Model behaviour on real prompts** — blocked on quota top-up.
- **Cockpit visual confirmation** — requires a human + browser; documented as the manual recipe above.
- **Production smoke against deployed Render API** — requires the artifact migration `10_workflow_artifacts` to be deployed to staging first (`pnpm db:migrate:deploy`).

These are deliberate gaps — they require things only the operator can do (spend money, open a browser, deploy a migration). The infrastructure is verified; the live operational checks are documented + ready to run.
