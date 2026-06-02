# Execution Engines

Current as of 2026-06-02.

JAK Swarm supports two LLM providers (OpenAI and Gemini) selected via `LLM_PROVIDER`, plus one workflow runtime:

| Layer | Active implementation | Notes |
|---|---|---|
| LLM execution (default) | `OpenAIRuntime` | Uses the Responses API for structured orchestration. GPT-5.5 is Tier 3, GPT-5.4 is Tier 1/2. |
| LLM execution (Gemini) | `GeminiRuntime` | Uses `@google/generative-ai` SDK. Gemini 2.5 Pro is Tier 3, 2.5 Flash is Tier 2, 2.5 Flash Lite is Tier 1. Selected when `LLM_PROVIDER=gemini`. |
| LLM provider (legacy path) | `OpenAIProvider` / `GeminiProvider` | Used by `LLMCallService` for the legacy `callLLM` path (Verifier, Planner-replan, reflectAndCorrect). Selected via `LLM_PROVIDER`. |
| Workflow orchestration | `LangGraphRuntime` | Uses native `@langchain/langgraph` `StateGraph`, Postgres checkpoints, `interrupt()`, and `Command(resume=...)`. |
| Agent runtime facade | `getRuntime()` | Returns `GeminiRuntime` when `LLM_PROVIDER=gemini` + `GEMINI_API_KEY` set; otherwise `OpenAIRuntime` when `OPENAI_API_KEY` set; otherwise `LegacyRuntime` for local tests. |
| Workflow runtime facade | `getWorkflowRuntime()` | Always returns `LangGraphRuntime`. The deleted SwarmGraph runtime is not selectable. |

## Environment Policy

| Env var | Current policy |
|---|---|
| `LLM_PROVIDER` | Optional. `existing` (default) or `gemini`. Selects the LLM provider for both runtime and legacy call paths. |
| `OPENAI_API_KEY` | Required when `LLM_PROVIDER` is unset or `existing`. |
| `OPENAI_MODEL_TIER_3` | Optional override for Tier 3; default `gpt-5.5`. |
| `OPENAI_MODEL_TIER_2` | Optional override for Tier 2; default `gpt-5.4`. |
| `OPENAI_MODEL_TIER_1` | Optional override for Tier 1; default `gpt-5.4`. |
| `GEMINI_API_KEY` | Required when `LLM_PROVIDER=gemini`. |
| `GEMINI_MODEL` | Optional global override for all Gemini tiers. |
| `GEMINI_MODEL_TIER_1` | Optional override for Tier 1; default `gemini-2.5-flash-lite`. |
| `GEMINI_MODEL_TIER_2` | Optional override for Tier 2; default `gemini-2.5-flash`. |
| `GEMINI_MODEL_TIER_3` | Optional override for Tier 3; default `gemini-2.5-pro`. |
| `GEMINI_REQUEST_TIMEOUT_MS` | Optional; default `60000`. |
| `JAK_EXECUTION_ENGINE` | Deprecated. Must be unset or `openai-first` in API config. |
| `JAK_WORKFLOW_RUNTIME` | Deprecated. Must be unset or `langgraph` in API config. |
| `JAK_OPENAI_RUNTIME_AGENTS` | Deprecated diagnostic/backcompat allowlist. It no longer limits OpenAI usage. |

Providers not yet integrated (Anthropic, DeepSeek, Ollama, OpenRouter) must not be configured as runtime keys. Gemini is the only non-OpenAI provider currently supported.

## Runtime Invariants

- API boot validation requires `OPENAI_API_KEY` in production (when `LLM_PROVIDER` is unset or `existing`), or `GEMINI_API_KEY` when `LLM_PROVIDER=gemini`.
- `/version` reports `effectiveExecutionEngine` and `workflowRuntimeStatus: active`.
- `GeminiRuntime.respondStructured()` uses zod validation on top of Gemini's `responseSchema` — same correctness guarantee as OpenAI's `json_schema` strict mode, with explicit parse errors on drift.
- Approval pauses use LangGraph interrupt/resume semantics and must not be bypassed by generic unpause/resume commands.
- High-risk actions must move through `ApprovalRequest` records and preserve audit evidence before execution continues.
- Legacy pricing/model rows, if present, are only for historical trace accounting and are not a runtime fallback path.
- Switching providers requires only changing `LLM_PROVIDER` env var and redeploying — no code changes, no DB migrations.

## Rollback

Set `LLM_PROVIDER=existing` (or unset it) and redeploy. All agents immediately revert to `OpenAIRuntime`. No DB migration to reverse, no Redis state to clear.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm check:truth`
- `GET /admin/diagnostics/models` shows the active provider and env vars.
- `GET /version` on the deployed API should show active LangGraph runtime.
