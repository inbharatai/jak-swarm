import type { Workflow, AgentTrace, ApprovalRequest } from '../types.js';

/**
 * Build the workflow detail response body with trace-recovery logic.
 *
 * If the worker's stale @jak-swarm/swarm dist resulted in a stub finalOutput,
 * surface real content from the trace history before responding to the client.
 */
export function buildWorkflowResponse(
  workflow: Workflow,
  traces: AgentTrace[],
  approvals: ApprovalRequest[],
): Record<string, unknown> {
  // Recovery: if the worker's stale @jak-swarm/swarm dist resulted in
  // a stub finalOutput, surface real content from the trace history
  // before responding to the client. Two recovery levels:
  //   1) Commander.directAnswer — for trivial inputs that should have
  //      short-circuited at __end__.
  //   2) Worker output — for non-trivial multi-agent workflows where
  //      Commander → Planner → Worker actually ran but the swarm graph
  //      reported FAILED for downstream reasons.
  const responseBody: Record<string, unknown> = { ...workflow, traces, approvals };
  const stub = /Agents completed their work but did not produce|No output produced/i;
  const fo = responseBody['finalOutput'];
  const isStubFinal = typeof fo !== 'string' || fo.trim().length === 0 || stub.test(fo);
  const wfTopError = workflow.error;
  const hasTopError = (typeof wfTopError === 'string' && wfTopError.trim().length > 0)
    || (wfTopError !== null && typeof wfTopError === 'object');

  // Special case: workflow has a top-level error AND no useful traces
  // (the planner / commander crashed before recording anything). Surface
  // the raw error to the chat — never let the stub through.
  if (isStubFinal && traces.length === 0 && hasTopError) {
    const errMsg = typeof wfTopError === 'string'
      ? wfTopError
      : ((wfTopError as { message?: unknown })?.message as string | undefined) ?? 'Unknown error';
    const isModel404 = /404|not found|does not exist/i.test(errMsg);
    const isAuthError = /401|unauthorized|invalid.*key/i.test(errMsg);
    const hint = isModel404
      ? ' The configured AI model returned 404 — check OPENAI_MODEL / OPENAI_BASE_URL / OPENAI_API_KEY in your environment.'
      : isAuthError
        ? ' The AI provider rejected the API key. Check OPENAI_API_KEY.'
        : '';
    responseBody['finalOutput'] =
      `**Workflow couldn\'t complete.**${hint}\n\n` +
      `**Underlying error:** \`${errMsg}\`\n\n` +
      `[View the full trace in Run Inspector](/swarm).`;
    responseBody['recoveryFallback'] = true;
    responseBody['recoveredErrorPreTrace'] = true;
  } else if (isStubFinal && traces.length > 0) {
    // Recovery #1: Commander directAnswer (trivial inputs)
    const cmd = traces.find((t) => t.agentRole === 'COMMANDER');
    const cmdOut = (cmd?.output ?? null) as { directAnswer?: unknown; clarificationNeeded?: unknown; clarificationQuestion?: unknown } | null;
    const da = typeof cmdOut?.directAnswer === 'string' ? cmdOut.directAnswer.trim() : '';
    const clarQ = typeof cmdOut?.clarificationQuestion === 'string' ? cmdOut.clarificationQuestion.trim() : '';
    if (da.length > 0) {
      responseBody['finalOutput'] = da;
      responseBody['status'] = 'COMPLETED';
      responseBody['error'] = null;
      responseBody['recoveredFromCommanderTrace'] = true;
    } else if (cmdOut?.clarificationNeeded === true && clarQ.length > 0) {
      // Recovery #1b: Commander requested clarification — surface the
      // question as the final answer so the user sees it in chat
      // instead of the generic "did not produce" stub.
      responseBody['finalOutput'] = clarQ;
      responseBody['status'] = 'COMPLETED';
      responseBody['error'] = null;
      responseBody['recoveredAsClarification'] = true;
    } else {
      // Recovery #2: pull substantive content from the worker traces
      // (skip orchestration roles). Walks nested objects + parses
      // stringified JSON so we catch outputs the legacy SwarmGraph
      // stores under arbitrary nested shapes (`output.result.content`,
      // `output.data.answer`, JSON-stringified payloads, etc.).
      const ORCH = new Set(['COMMANDER', 'PLANNER', 'ROUTER', 'VERIFIER', 'GUARDRAIL', 'APPROVAL', 'SWARMRUNNER', 'SUPERVISOR']);
      const FIELDS = ['content', 'answer', 'response', 'message', 'findings', 'summary', 'document',
                      'result', 'output', 'draft', 'code', 'architecture', 'analysis', 'strategy',
                      'recommendation', 'conclusion', 'explanation', 'plan', 'text', 'body', 'report',
                      'markdown', 'reply', 'finalOutput', 'directAnswer',
                      'designSpec', 'layoutGrid', 'userFlowDescription',
                      'overallDescription', 'layoutAnalysis', 'diagnosis', 'rootCause'];
      const MIN_CONTENT_LEN = 30;
      const MAX_DEPTH = 4;

      // Recursively walk an unknown value and return the best
      // substantive string it contains. Tries known field names first,
      // then any string > MIN_CONTENT_LEN. Parses JSON-string fields
      // up to MAX_DEPTH so worker outputs serialized as strings still
      // get unwrapped.
      const extractContent = (val: unknown, depth: number): string => {
        if (depth > MAX_DEPTH) return '';
        if (typeof val === 'string') {
          const trimmed = val.trim();
          if (trimmed.length === 0) return '';
          // Try to unwrap JSON-stringified payloads
          if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length < 64_000) {
            try {
              const parsed = JSON.parse(trimmed);
              const inner = extractContent(parsed, depth + 1);
              if (inner.length >= MIN_CONTENT_LEN) return inner;
            } catch { /* not JSON, treat as plain text */ }
          }
          return trimmed.length >= MIN_CONTENT_LEN ? trimmed : '';
        }
        if (Array.isArray(val)) {
          let best = '';
          for (const item of val) {
            const c = extractContent(item, depth + 1);
            if (c.length > best.length) best = c;
          }
          return best;
        }
        if (val && typeof val === 'object') {
          const obj = val as Record<string, unknown>;
          // Pass 1: known field names
          for (const f of FIELDS) {
            const c = extractContent(obj[f], depth + 1);
            if (c.length >= MIN_CONTENT_LEN) return c;
          }
          // Pass 2: any string field
          let best = '';
          for (const v of Object.values(obj)) {
            const c = extractContent(v, depth + 1);
            if (c.length > best.length) best = c;
          }
          return best;
        }
        return '';
      };

      const sections: Array<{ role: string; content: string }> = [];
      for (const t of traces) {
        if (ORCH.has(t.agentRole)) continue;
        const o = t.output as unknown;
        if (!o) continue;
        const content = extractContent(o, 0);
        if (content.length >= MIN_CONTENT_LEN) {
          const displayRole = t.agentRole.replace(/^WORKER_/, '').replace(/_/g, ' ');
          sections.push({ role: displayRole, content });
        }
      }
      if (sections.length > 0) {
        responseBody['finalOutput'] = sections.length === 1 && sections[0]
          ? sections[0]!.content
          : sections.map((s) => `## ${s.role}\n\n${s.content}`).join('\n\n---\n\n');
        responseBody['status'] = 'COMPLETED';
        responseBody['error'] = null;
        responseBody['recoveredFromWorkerTraces'] = true;
      } else {
        // Recovery #3: when no worker output is recoverable, surface
        // the FIRST diagnostic error from the traces so the user can
        // act on it instead of seeing a generic "no response" message.
        // Common case: an LLM provider 404 (model not found / wrong
        // base URL) — the user can fix that instantly given the right
        // signal. The literal "did not produce a user-facing response"
        // string must NEVER reach the chat UI per the QA brief.
        type TraceLike = { agentRole?: string; error?: unknown; output?: unknown };
        const firstTraceError = (traces as TraceLike[]).find((t) => {
          const e = t.error;
          if (typeof e === 'string' && e.trim().length > 0) return true;
          if (e && typeof e === 'object' && 'message' in (e as Record<string, unknown>)) return true;
          return false;
        });
        const errMsg = (() => {
          if (firstTraceError) {
            const e = firstTraceError.error;
            if (typeof e === 'string') return e;
            if (e && typeof e === 'object') {
              const o = e as Record<string, unknown>;
              if (typeof o['message'] === 'string') return o['message'];
            }
          }
          if (typeof wfTopError === 'string' && wfTopError.trim().length > 0) return wfTopError;
          return null;
        })();
        const failingRole = firstTraceError?.agentRole ?? null;

        if (errMsg) {
          // Surface the diagnostic in plain English. Most-common pattern
          // is `OpenAI request failed (model: gpt-5.4): 404 status code
          // (no body)` → keep the technical detail but add a
          // user-actionable explanation + Inspector link.
          const isModel404 = /404|not found|does not exist/i.test(errMsg);
          const isAuthError = /401|unauthorized|invalid.*key/i.test(errMsg);
          const isRateLimit = /429|rate.*limit/i.test(errMsg);
          const hint = isModel404
            ? 'The configured AI model returned 404 — the model name in OPENAI_MODEL or the OPENAI_BASE_URL is likely wrong. '
            : isAuthError
              ? 'The AI provider rejected the API key. Check OPENAI_API_KEY in your environment. '
              : isRateLimit
                ? 'The AI provider rate-limited the request. Try again in a moment, or upgrade the API key tier. '
                : '';
          responseBody['finalOutput'] =
            `**Workflow couldn\'t complete.** ${hint}` +
            (failingRole ? `Failed at **${failingRole}** node.\n\n` : '') +
            `**Underlying error:** \`${errMsg}\`\n\n` +
            `[View the full trace in Run Inspector](/swarm).`;
          responseBody['recoveryFallback'] = true;
          responseBody['recoveredErrorFromTrace'] = true;
        } else {
          responseBody['finalOutput'] =
            `JAK completed the run, but no final response was generated. ` +
            `You can view the detailed trace in [Run Inspector](/swarm).`;
          responseBody['recoveryFallback'] = true;
        }
      }
    }
  }

  return responseBody;
}
