/**
 * Per-tenant LLM API key side-channel registry.
 *
 * SwarmState is persisted to Postgres on every transition, which means
 * `state` cannot carry decrypted API keys (they would be written to the
 * DB in plaintext). The per-tenant LLM provider feature needs decrypted
 * API keys at agent execution time, but they must never touch the
 * persisted state.
 *
 * Mirrors the existing pattern at `supervisor/activity-registry.ts`:
 * a per-workflow-id map, registered by the workflow runtime just before
 * execution runs, consumed by worker nodes when they build the
 * AgentContext. The registry is process-local and ephemeral — it is
 * not persisted and does not cross instance boundaries.
 *
 * Security: The decrypted key lives only in this in-memory map for the
 * duration of the workflow. It is cleared in the `finally` block when
 * the workflow terminates.
 */

const llmApiKeys = new Map<string, string>();

/**
 * Register a decrypted LLM API key for a given workflow.
 * Called by swarm-execution.service.ts after reading + decrypting from
 * TenantMemory. Safe to call multiple times — the latest wins.
 */
export function registerLLMApiKey(
  workflowId: string,
  apiKey: string,
): void {
  llmApiKeys.set(workflowId, apiKey);
}

/**
 * Look up the decrypted LLM API key for a workflow. Returns undefined
 * when no key is registered (e.g. tenant uses env-var default, unit
 * tests, legacy callers) — worker nodes treat that as "use env var".
 */
export function getLLMApiKey(workflowId: string): string | undefined {
  return llmApiKeys.get(workflowId);
}

/**
 * Remove the LLM API key once the workflow terminates. Called by the
 * workflow runtime in `finally` so we don't leak memory or hold
 * decrypted keys longer than necessary.
 */
export function clearLLMApiKey(workflowId: string): void {
  llmApiKeys.delete(workflowId);
}