# Execution Engines

Current as of 2026-05-10.

JAK Swarm now has one production LLM runtime and one workflow runtime:

| Layer | Active implementation | Notes |
|---|---|---|
| LLM execution | OpenAI-only model execution | `OpenAIRuntime` uses the Responses API for structured orchestration. Some worker/tool-loop call sites still use chat-compatible OpenAI calls during migration. GPT-5.5 is the Tier 3 orchestration/default-premier path. GPT-5.4 is the Tier 1/2 worker/balanced path. |
| Workflow orchestration | `LangGraphRuntime` | Uses native `@langchain/langgraph` `StateGraph`, Postgres checkpoints, `interrupt()`, and `Command(resume=...)`. |
| Agent runtime facade | `getRuntime()` | Enforces OpenAI when `OPENAI_API_KEY` is set. `JAK_EXECUTION_ENGINE=legacy` is ignored by the package runtime and rejected by API config. |
| Workflow runtime facade | `getWorkflowRuntime()` | Always returns `LangGraphRuntime`. The deleted SwarmGraph runtime is not selectable. |

## Environment Policy

| Env var | Current policy |
|---|---|
| `OPENAI_API_KEY` | Required for production LLM execution. |
| `OPENAI_MODEL_TIER_3` | Optional override for Tier 3; default `gpt-5.5`. |
| `OPENAI_MODEL_TIER_2` | Optional override for Tier 2; default `gpt-5.4`. |
| `OPENAI_MODEL_TIER_1` | Optional override for Tier 1; default `gpt-5.4`. |
| `JAK_EXECUTION_ENGINE` | Deprecated. Must be unset or `openai-first` in API config. |
| `JAK_WORKFLOW_RUNTIME` | Deprecated. Must be unset or `langgraph` in API config. |
| `JAK_OPENAI_RUNTIME_AGENTS` | Deprecated diagnostic/backcompat allowlist. It no longer limits OpenAI usage. |

Do not configure Anthropic, Gemini, DeepSeek, Ollama, or OpenRouter runtime keys. Those adapters are not part of the current execution path and must not be documented as fallback providers.

## Runtime Invariants

- API boot validation requires `OPENAI_API_KEY` in production.
- `/version` reports `effectiveExecutionEngine: openai-first` and `workflowRuntimeStatus: active`.
- Approval pauses use LangGraph interrupt/resume semantics and must not be bypassed by generic unpause/resume commands.
- High-risk actions must move through `ApprovalRequest` records and preserve audit evidence before execution continues.
- Legacy pricing/model rows, if present, are only for historical trace accounting and are not a runtime fallback path.
- Until every worker/tool-loop call site is ported onto `OpenAIRuntime.callTools`, public copy must say "OpenAI-only" rather than "Responses API is the enforced execution path".

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm check:truth`
- `GET /version` on the deployed API should show OpenAI-first and active LangGraph runtime.
