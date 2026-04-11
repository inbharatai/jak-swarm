import { WorkflowStatus } from '@jak-swarm/shared';
import { GuardrailAgent, AgentContext } from '@jak-swarm/agents';
import type { GuardrailInput } from '@jak-swarm/agents';
import type { SwarmState } from '../../state/swarm-state.js';
import { getCurrentTask } from '../../state/swarm-state.js';

// ─── Verification Engine Integration ────────────────────────────────────────

/** Keywords that indicate the task involves verifiable content. */
const EMAIL_KEYWORDS = ['email', 'mail', 'inbox', 'phishing', 'spam', 'message'];
const DOCUMENT_KEYWORDS = ['document', 'pdf', 'contract', 'certificate', 'resume', 'cv', 'invoice'];
const TRANSACTION_KEYWORDS = ['payment', 'invoice', 'transaction', 'transfer', 'wire', 'billing', 'financial'];
const IDENTITY_KEYWORDS = ['resume', 'credential', 'identity', 'background', 'hire', 'candidate'];

/** Email-related tools that should trigger verification. */
const EMAIL_TOOLS = new Set(['read_email', 'draft_email', 'send_email', 'gmail_read_inbox']);
const DOCUMENT_TOOLS = new Set(['extract_document_data', 'summarize_document', 'pdf_extract_text', 'pdf_analyze']);
const FINANCIAL_TOOLS = new Set(['submit_payment', 'create_invoice']);

function detectVerificationType(
  taskDescription: string,
  toolsRequired?: string[],
): 'EMAIL' | 'DOCUMENT' | 'TRANSACTION' | 'IDENTITY' | null {
  const desc = taskDescription.toLowerCase();
  const tools = new Set(toolsRequired ?? []);

  // Check tools first (more reliable than description keywords)
  if ([...EMAIL_TOOLS].some(t => tools.has(t))) return 'EMAIL';
  if ([...DOCUMENT_TOOLS].some(t => tools.has(t))) return 'DOCUMENT';
  if ([...FINANCIAL_TOOLS].some(t => tools.has(t))) return 'TRANSACTION';

  // Fall back to keyword detection
  if (EMAIL_KEYWORDS.some(k => desc.includes(k))) return 'EMAIL';
  if (TRANSACTION_KEYWORDS.some(k => desc.includes(k))) return 'TRANSACTION';
  if (IDENTITY_KEYWORDS.some(k => desc.includes(k))) return 'IDENTITY';
  if (DOCUMENT_KEYWORDS.some(k => desc.includes(k))) return 'DOCUMENT';

  return null;
}

// ─── Main Guardrail Node ────────────────────────────────────────────────────

export async function guardrailNode(state: SwarmState): Promise<Partial<SwarmState>> {
  const task = getCurrentTask(state);

  if (!task) {
    return { blocked: false };
  }

  const agent = new GuardrailAgent();

  const context = new AgentContext({
    tenantId: state.tenantId,
    userId: state.userId,
    workflowId: state.workflowId,
    industry: state.industry,
  });

  const guardrailInput: GuardrailInput = {
    content: JSON.stringify({
      taskName: task.name,
      taskDescription: task.description,
      goal: state.goal,
    }),
    action: task.name,
    riskLevel: task.riskLevel,
    toolsToExecute: task.toolsRequired,
    checkType: 'ACTION',
  };

  const result = await agent.execute(guardrailInput, context);

  // ─── Verification Engine: auto-verify when task involves sensitive content ──
  const verificationType = detectVerificationType(task.description, task.toolsRequired);
  if (verificationType && !result.injectionAttempted) {
    try {
      const { verify } = await import('@jak-swarm/verification');
      const verificationResult = await verify({
        type: verificationType,
        content: JSON.stringify({ task: task.name, description: task.description, goal: state.goal }),
        contentType: 'text/plain',
        metadata: { taskName: task.name, tools: task.toolsRequired },
        tenantId: state.tenantId,
        userId: state.userId,
        workflowId: state.workflowId,
      });

      // If verification finds HIGH or CRITICAL risk, add to violations
      if (verificationResult.risk.level === 'HIGH' || verificationResult.risk.level === 'CRITICAL') {
        result.violations.push(
          `Verification Engine [${verificationType}]: ${verificationResult.summary}`,
        );
        result.safe = false;

        // CRITICAL = block, HIGH = flag for review
        if (verificationResult.risk.level === 'CRITICAL') {
          result.blockedAction = `verification-${verificationType.toLowerCase()}`;
        }
      }
    } catch (err) {
      // Verification engine errors should never block the workflow —
      // the guardrail's own checks still apply
      context.addTrace({
        traceId: context.traceId,
        runId: context.runId,
        agentRole: 'GUARDRAIL' as any,
        stepIndex: 0,
        input: { verificationType },
        output: { error: err instanceof Error ? err.message : 'Verification engine unavailable' },
        toolCalls: [],
        handoffs: [],
        startedAt: new Date(),
        completedAt: new Date(),
        durationMs: 0,
      });
    }
  }

  if (!result.safe) {
    return {
      guardrailResult: result,
      blocked: result.injectionAttempted || result.blockedAction !== undefined,
      error: result.violations.join('; '),
      status: result.injectionAttempted ? WorkflowStatus.FAILED : WorkflowStatus.EXECUTING,
      traces: context.getTraces(),
    };
  }

  return {
    guardrailResult: result,
    blocked: false,
    traces: context.getTraces(),
  };
}
