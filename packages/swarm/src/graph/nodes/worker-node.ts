import { AgentRole, WorkflowStatus, TaskStatus } from '@jak-swarm/shared';
import {
  AgentContext,
  EmailAgent,
  DocumentAgent,
  ResearchAgent,
  BrowserAgent,
  SupportAgent,
  CalendarAgent,
  CRMAgent,
  SpreadsheetAgent,
  OpsAgent,
  VoiceAgent,
  KnowledgeAgent,
  CoderAgent,
  DesignerAgent,
  StrategistAgent,
  MarketingAgent,
  TechnicalAgent,
  FinanceAgent,
  HRAgent,
  GrowthAgent,
  ContentAgent,
  SEOAgent,
  PRAgent,
  LegalAgent,
  SuccessAgent,
  AnalyticsAgent,
  ProductAgent,
  ProjectAgent,
  AppArchitectAgent,
  AppGeneratorAgent,
  AppDebuggerAgent,
  AppDeployerAgent,
  ScreenshotToCodeAgent,
} from '@jak-swarm/agents';
import type { SwarmState } from '../../state/swarm-state.js';
import { getCurrentTask } from '../../state/swarm-state.js';
import { getCircuitBreaker, CircuitOpenError } from '../../supervisor/circuit-breaker.js';

export async function workerNode(state: SwarmState): Promise<Partial<SwarmState>> {
  const task = getCurrentTask(state);

  if (!task) {
    return {
      status: WorkflowStatus.FAILED,
      error: 'Worker node: no current task found',
    };
  }

  const context = new AgentContext({
    tenantId: state.tenantId,
    userId: state.userId,
    workflowId: state.workflowId,
    industry: state.industry,
    browserAutomationEnabled: state.browserAutomationEnabled,
    restrictedCategories: state.restrictedCategories,
    disabledToolNames: state.disabledToolNames,
    connectedProviders: state.connectedProviders,
  });

  let output: unknown;
  let taskFailed = false;

  try {
    const agent = createWorkerAgent(task.agentRole);

    if (!agent) {
      taskFailed = true;
      output = {
        error: `No worker agent registered for role: ${task.agentRole}`,
        taskId: task.id,
      };
    } else {
      // Build task input from task description and any upstream results
      const taskInput = buildTaskInput(task, state);

      // Execute through circuit breaker — prevents cascading failures
      // when a particular agent role fails repeatedly.
      // Uses distributed breaker if provided (multi-instance), else local.
      const breakerFactory = (state as unknown as Record<string, unknown>)['circuitBreakerFactory'] as
        | ((name: string, opts: { failureThreshold: number; resetTimeoutMs: number }) => { call: <T>(fn: () => Promise<T>) => Promise<T> })
        | undefined;

      const breaker = breakerFactory
        ? breakerFactory(`worker:${task.agentRole}`, { failureThreshold: 5, resetTimeoutMs: 30_000 })
        : getCircuitBreaker(`worker:${task.agentRole}`, { failureThreshold: 5, resetTimeoutMs: 30_000, tenantId: state.tenantId });

      try {
        output = await breaker.call<unknown>(() => agent.execute(taskInput, context));
      } catch (err) {
        if (err instanceof CircuitOpenError || (err instanceof Error && err.message.includes('circuit breaker'))) {
          taskFailed = true;
          output = {
            error: `Circuit breaker open for ${task.agentRole}: ${err.message}`,
            taskId: task.id,
          };
        } else {
          throw err; // Re-throw non-circuit-breaker errors for outer catch
        }
      }

      // Self-correction: agent reviews its own output before passing to verifier.
      // This catches obvious errors early, reducing verifier retry loops.
      if (!taskFailed && output && typeof output === 'object') {
        try {
          const outputStr = JSON.stringify(output);
          const { corrected, wasChanged } = await agent.reflectAndCorrect(
            outputStr,
            task.description,
            { maxTokens: 2048 },
          );
          if (wasChanged) {
            try {
              output = JSON.parse(corrected);
            } catch {
              // Correction wasn't valid JSON — keep original
            }
          }
        } catch {
          // Self-reflection failed — continue with original output
        }
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    taskFailed = true;
    output = { error: errorMessage, taskId: task.id };
  }

  const traces = context.getTraces();

  // Update task status — reflect actual success/failure
  const updatedPlan = state.plan
    ? {
        ...state.plan,
        tasks: state.plan.tasks.map((t) =>
          t.id === task.id
            ? {
                ...t,
                status: taskFailed ? TaskStatus.FAILED : TaskStatus.COMPLETED,
                completedAt: new Date(),
                error: taskFailed
                  ? String((output as Record<string, unknown>)['error'] ?? 'Unknown worker error')
                  : undefined,
              }
            : t,
        ),
      }
    : state.plan;

  return {
    taskResults: { [task.id]: output },
    outputs: [output],
    plan: updatedPlan,
    traces,
    // Hand off to verifier even on failure — verifier decides retry vs pass-through
    status: WorkflowStatus.VERIFYING,
    // Surface the error for visibility; verifier will make the final call
    error: taskFailed
      ? String((output as Record<string, unknown>)['error'] ?? 'Worker failed')
      : undefined,
  };
}

function createWorkerAgent(role: AgentRole) {
  switch (role) {
    case AgentRole.WORKER_EMAIL:
      return new EmailAgent();
    case AgentRole.WORKER_DOCUMENT:
      return new DocumentAgent();
    case AgentRole.WORKER_RESEARCH:
      return new ResearchAgent();
    case AgentRole.WORKER_KNOWLEDGE:
      return new KnowledgeAgent();
    case AgentRole.WORKER_BROWSER:
      return new BrowserAgent();
    case AgentRole.WORKER_SUPPORT:
      return new SupportAgent();
    case AgentRole.WORKER_CALENDAR:
      return new CalendarAgent();
    case AgentRole.WORKER_CRM:
      return new CRMAgent();
    case AgentRole.WORKER_SPREADSHEET:
      return new SpreadsheetAgent();
    case AgentRole.WORKER_OPS:
      return new OpsAgent();
    case AgentRole.WORKER_VOICE:
      return new VoiceAgent();
    case AgentRole.WORKER_CODER:
      return new CoderAgent();
    case AgentRole.WORKER_DESIGNER:
      return new DesignerAgent();
    case AgentRole.WORKER_STRATEGIST:
      return new StrategistAgent();
    case AgentRole.WORKER_MARKETING:
      return new MarketingAgent();
    case AgentRole.WORKER_TECHNICAL:
      return new TechnicalAgent();
    case AgentRole.WORKER_FINANCE:
      return new FinanceAgent();
    case AgentRole.WORKER_HR:
      return new HRAgent();
    case AgentRole.WORKER_GROWTH:
      return new GrowthAgent();
    case AgentRole.WORKER_CONTENT:
      return new ContentAgent();
    case AgentRole.WORKER_SEO:
      return new SEOAgent();
    case AgentRole.WORKER_PR:
      return new PRAgent();
    case AgentRole.WORKER_LEGAL:
      return new LegalAgent();
    case AgentRole.WORKER_SUCCESS:
      return new SuccessAgent();
    case AgentRole.WORKER_ANALYTICS:
      return new AnalyticsAgent();
    case AgentRole.WORKER_PRODUCT:
      return new ProductAgent();
    case AgentRole.WORKER_PROJECT:
      return new ProjectAgent();
    // Vibe Coding agents
    case AgentRole.WORKER_APP_ARCHITECT:
      return new AppArchitectAgent();
    case AgentRole.WORKER_APP_GENERATOR:
      return new AppGeneratorAgent();
    case AgentRole.WORKER_APP_DEBUGGER:
      return new AppDebuggerAgent();
    case AgentRole.WORKER_APP_DEPLOYER:
      return new AppDeployerAgent();
    case AgentRole.WORKER_SCREENSHOT_TO_CODE:
      return new ScreenshotToCodeAgent();
    default:
      return null;
  }
}

function buildTaskInput(
  task: import('@jak-swarm/shared').WorkflowTask,
  state: SwarmState,
): unknown {
  // Gather results from dependencies
  const dependencyResults: Record<string, unknown> = {};
  for (const depId of task.dependsOn) {
    if (state.taskResults[depId] !== undefined) {
      dependencyResults[depId] = state.taskResults[depId];
    }
  }

  // Build role-specific input
  switch (task.agentRole) {
    case AgentRole.WORKER_EMAIL:
      return {
        action: inferEmailAction(task),
        filters: { limit: 10 },
        dependencyResults,
      };
    case AgentRole.WORKER_DOCUMENT:
      return {
        action: inferDocumentAction(task),
        documentContent: extractDocumentContent(dependencyResults),
        dependencyResults,
      };
    case AgentRole.WORKER_RESEARCH:
    case AgentRole.WORKER_KNOWLEDGE:
      return {
        query: task.description,
        maxSources: 5,
        focusArea: state.missionBrief?.subFunction,
        dependencyResults,
      };
    case AgentRole.WORKER_BROWSER:
    {
        const browserPlan = buildBrowserExecutionPlan(task.description, task.requiresApproval);
        return {
          actions: browserPlan.actions,
          allowedDomains: state.allowedDomains ?? [],
          // Preserve planner/policy approval intent. Worker logic must not weaken it.
          requiresApproval: task.requiresApproval,
          safetyMode: browserPlan.safetyMode,
          safetyReason: browserPlan.safetyReason,
          dependencyResults,
        };
      }
    case AgentRole.WORKER_SUPPORT:
      return {
        action: 'CLASSIFY' as const,
        ticketContent: task.description,
        dependencyResults,
      };
    case AgentRole.WORKER_CALENDAR:
      return {
        action: inferCalendarAction(task),
        filters: {},
        dependencyResults,
      };
    case AgentRole.WORKER_CRM:
      return {
        action: inferCRMAction(task),
        query: task.description,
        dependencyResults,
      };
    case AgentRole.WORKER_SPREADSHEET:
      return {
        action: inferSpreadsheetAction(task),
        data: extractDataContent(dependencyResults),
        instructions: task.description,
        dependencyResults,
      };
    case AgentRole.WORKER_OPS:
      return {
        action: inferOpsAction(task),
        instructions: task.description,
        context: state.missionBrief?.subFunction,
        dependencyResults,
      };
    case AgentRole.WORKER_VOICE:
      return {
        action: inferVoiceAction(task),
        content: task.description,
        transcript: extractVoiceContent(dependencyResults),
        dependencyResults,
      };
    case AgentRole.WORKER_CODER:
      return {
        action: inferCoderAction(task),
        requirements: task.description,
        language: inferLanguage(task),
        dependencyResults,
      };
    case AgentRole.WORKER_DESIGNER:
      return {
        action: inferDesignerAction(task),
        brief: task.description,
        dependencyResults,
      };
    case AgentRole.WORKER_STRATEGIST:
      return {
        action: inferStrategyAction(task),
        question: task.description,
        context: state.missionBrief?.subFunction,
        industry: state.industry,
        dependencyResults,
      };
    case AgentRole.WORKER_MARKETING:
      return {
        action: inferMarketingAction(task),
        brief: task.description,
        industry: state.industry,
        dependencyResults,
      };
    case AgentRole.WORKER_TECHNICAL:
      return {
        action: inferTechnicalAction(task),
        question: task.description,
        dependencyResults,
      };
    case AgentRole.WORKER_FINANCE:
      return {
        action: inferFinanceAction(task),
        question: task.description,
        data: extractDataContent(dependencyResults),
        dependencyResults,
      };
    case AgentRole.WORKER_HR:
      return {
        action: inferHRAction(task),
        request: task.description,
        dependencyResults,
      };
    case AgentRole.WORKER_GROWTH:
      return {
        action: inferGrowthAction(task),
        description: task.description,
        targetCompany: extractCompanyFromDescription(task.description),
        keyword: extractKeywordFromDescription(task.description),
        url: extractUrlFromDescription(task.description),
        dependencyResults,
      };
    case AgentRole.WORKER_CONTENT:
      return {
        action: inferContentAction(task),
        topic: task.description,
        audience: state.missionBrief?.subFunction,
        industry: state.industry,
        dependencyResults,
      };
    case AgentRole.WORKER_SEO:
      return {
        action: inferSEOAction(task),
        url: extractUrlFromDescription(task.description),
        keyword: extractKeywordFromDescription(task.description),
        currentContent: extractDocumentContent(dependencyResults),
        dependencyResults,
      };
    case AgentRole.WORKER_PR:
      return {
        action: inferPRAction(task),
        topic: task.description,
        company: extractCompanyFromDescription(task.description),
        audience: state.missionBrief?.subFunction,
        dependencyResults,
      };
    case AgentRole.WORKER_LEGAL:
      return {
        action: inferLegalAction(task),
        document: extractDocumentContent(dependencyResults),
        industry: state.industry,
        description: task.description,
        dependencyResults,
      };
    case AgentRole.WORKER_SUCCESS:
      return {
        action: inferSuccessAction(task),
        customerName: extractCompanyFromDescription(task.description),
        industry: state.industry,
        description: task.description,
        dependencyResults,
      };
    case AgentRole.WORKER_ANALYTICS:
      return {
        action: inferAnalyticsAction(task),
        query: task.description,
        data: extractDataContent(dependencyResults),
        dependencyResults,
      };
    case AgentRole.WORKER_PRODUCT:
      return {
        action: inferProductAction(task),
        feature: task.description,
        industry: state.industry,
        dependencyResults,
      };
    case AgentRole.WORKER_PROJECT:
      return {
        action: inferProjectAction(task),
        projectName: task.name,
        description: task.description,
        dependencyResults,
      };
    // Vibe Coding agents
    case AgentRole.WORKER_APP_ARCHITECT:
      return {
        action: inferAppArchitectAction(task),
        description: task.description,
        framework: 'nextjs',
        features: task.description ? [task.description] : [],
        industry: state.industry,
        dependencyResults,
      };
    case AgentRole.WORKER_APP_GENERATOR:
      return {
        action: inferAppGeneratorAction(task),
        architecture: dependencyResults ? JSON.stringify(dependencyResults) : undefined,
        framework: 'nextjs',
        dependencyResults,
      };
    case AgentRole.WORKER_APP_DEBUGGER:
      return {
        action: inferAppDebuggerAction(task),
        errorLog: task.description,
        errorType: 'build' as const,
        dependencyResults,
      };
    case AgentRole.WORKER_APP_DEPLOYER:
      return {
        action: inferAppDeployerAction(task),
        projectName: task.name ?? 'jak-project',
        framework: 'nextjs',
        dependencyResults,
      };
    case AgentRole.WORKER_SCREENSHOT_TO_CODE:
      return {
        action: 'ANALYZE_SCREENSHOT' as const,
        targetFramework: 'nextjs',
        additionalInstructions: task.description,
        dependencyResults,
      };
    default:
      return { task, dependencyResults };
  }
}

type BrowserActionType = 'NAVIGATE' | 'EXTRACT' | 'FILL_FORM' | 'CLICK' | 'SCREENSHOT' | 'WAIT';
export type BrowserActionRisk = 'READ' | 'NAVIGATION' | 'WRITE';
export type IntentConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface BrowserActionShape {
  type: BrowserActionType;
  url?: string;
  selector?: string;
}

export interface BrowserIntentCandidate {
  action: BrowserActionShape;
  confidence: IntentConfidence;
  risk: BrowserActionRisk;
  reason: string;
}

export interface BrowserExecutionPlan {
  actions: BrowserActionShape[];
  safetyMode: 'NORMAL' | 'SAFE_READ_ONLY';
  safetyReason?: string;
}

export function buildBrowserExecutionPlan(description: string, upstreamApprovalRequired: boolean): BrowserExecutionPlan {
  const candidates = inferBrowserIntentCandidates(description);
  const deterministic = candidates.filter((c) => c.confidence !== 'LOW');

  if (deterministic.length === 0) {
    return {
      // Ambiguous browser tasks default to read-only extraction for deterministic behavior.
      actions: [{ type: 'EXTRACT', selector: 'body' }],
      safetyMode: 'SAFE_READ_ONLY',
      safetyReason: 'Low-confidence browser intent; falling back to safe read-only extraction.',
    };
  }

  // Worker never escalates write actions into execution unless approval was already required upstream.
  const blockedWrite = deterministic.filter((c) => c.risk === 'WRITE' && !upstreamApprovalRequired);
  if (blockedWrite.length > 0) {
    const safeActions = deterministic
      .filter((c) => c.risk !== 'WRITE')
      .map((c) => c.action);

    return {
      actions: safeActions.length > 0 ? safeActions : [{ type: 'EXTRACT', selector: 'body' }],
      safetyMode: 'SAFE_READ_ONLY',
      safetyReason: `Blocked side-effect browser intents without explicit upstream approval: ${blockedWrite
        .map((c) => c.action.type)
        .join(', ')}`,
    };
  }

  return {
    actions: deterministic.map((c) => c.action),
    safetyMode: 'NORMAL',
  };
}

function inferBrowserIntentCandidates(description: string): BrowserIntentCandidate[] {
  const desc = description.toLowerCase();
  const candidates: BrowserIntentCandidate[] = [];
  const url = extractUrlFromDescription(description);

  if (url) {
    candidates.push({
      action: { type: 'NAVIGATE', url },
      confidence: 'HIGH',
      risk: 'NAVIGATION',
      reason: 'Explicit URL detected in task description.',
    });
  }

  if (/\b(extract|read|scrape|capture|inspect)\b/.test(desc)) {
    candidates.push({
      action: { type: 'EXTRACT', selector: 'body' },
      confidence: 'MEDIUM',
      risk: 'READ',
      reason: 'Read-only extraction intent detected.',
    });
  }

  if (/\b(wait|load|appear|visible)\b/.test(desc)) {
    candidates.push({
      action: { type: 'WAIT' },
      confidence: 'MEDIUM',
      risk: 'READ',
      reason: 'Wait intent detected for page readiness.',
    });
  }

  if (/\b(fill form|complete form|enter details|submit form|apply now|send application)\b/.test(desc)) {
    candidates.push({
      action: { type: 'FILL_FORM' },
      confidence: 'MEDIUM',
      risk: 'WRITE',
      reason: 'Potential side-effect form interaction intent detected.',
    });
  }

  if (/\b(click|submit|confirm|purchase|delete|send)\b/.test(desc)) {
    candidates.push({
      action: { type: 'CLICK' },
      confidence: 'LOW',
      risk: 'WRITE',
      reason: 'Click/submit intent detected but ambiguous without explicit selector context.',
    });
  }

  return dedupeBrowserCandidates(candidates);
}

function dedupeBrowserCandidates(candidates: BrowserIntentCandidate[]): BrowserIntentCandidate[] {
  const byType = new Map<BrowserActionType, BrowserIntentCandidate>();
  for (const candidate of candidates) {
    const existing = byType.get(candidate.action.type);
    if (!existing || confidenceRank(candidate.confidence) > confidenceRank(existing.confidence)) {
      byType.set(candidate.action.type, candidate);
    }
  }
  return [...byType.values()];
}

function confidenceRank(level: IntentConfidence): number {
  if (level === 'HIGH') return 3;
  if (level === 'MEDIUM') return 2;
  return 1;
}

function inferEmailAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('send')) return 'SEND';
  if (desc.includes('draft') || desc.includes('compose') || desc.includes('write')) return 'DRAFT';
  if (desc.includes('summarize') || desc.includes('summary')) return 'SUMMARIZE';
  if (desc.includes('classify') || desc.includes('categorize')) return 'CLASSIFY';
  return 'READ';
}

function inferDocumentAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('extract')) return 'EXTRACT';
  if (desc.includes('generate') || desc.includes('create') || desc.includes('write')) return 'GENERATE';
  if (desc.includes('classify') || desc.includes('categorize')) return 'CLASSIFY';
  if (desc.includes('compare')) return 'COMPARE';
  return 'SUMMARIZE';
}

function extractDocumentContent(results: Record<string, unknown>): string | undefined {
  for (const value of Object.values(results)) {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'content' in value) {
      return String((value as Record<string, unknown>)['content']);
    }
  }
  return undefined;
}

function inferCalendarAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('create') || desc.includes('schedule') || desc.includes('book')) return 'CREATE_EVENT';
  if (desc.includes('update') || desc.includes('reschedule') || desc.includes('move')) return 'UPDATE_EVENT';
  if (desc.includes('delete') || desc.includes('cancel')) return 'DELETE_EVENT';
  if (desc.includes('availability') || desc.includes('free') || desc.includes('open slot')) return 'FIND_AVAILABILITY';
  return 'LIST_EVENTS';
}

function inferCRMAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('update') || desc.includes('edit') || desc.includes('modify')) return 'UPDATE';
  if (desc.includes('note') || desc.includes('log') || desc.includes('record')) return 'CREATE_NOTE';
  if (desc.includes('deal') || desc.includes('pipeline') || desc.includes('opportunity')) return 'SEARCH_DEALS';
  if (desc.includes('list') || desc.includes('all contact')) return 'LIST_CONTACTS';
  return 'LOOKUP';
}

function inferSpreadsheetAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('transform') || desc.includes('clean') || desc.includes('convert')) return 'TRANSFORM';
  if (desc.includes('report') || desc.includes('generate')) return 'GENERATE_REPORT';
  if (desc.includes('pivot') || desc.includes('group by')) return 'PIVOT';
  if (desc.includes('chart') || desc.includes('visuali') || desc.includes('graph')) return 'CHART_DATA';
  return 'ANALYZE';
}

function inferOpsAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('monitor') || desc.includes('check') || desc.includes('status')) return 'MONITOR';
  if (desc.includes('config') || desc.includes('set up') || desc.includes('deploy')) return 'CONFIGURE';
  if (desc.includes('troubleshoot') || desc.includes('debug') || desc.includes('diagnos')) return 'TROUBLESHOOT';
  if (desc.includes('automate') || desc.includes('script') || desc.includes('schedule')) return 'AUTOMATE';
  return 'EXECUTE_PROCEDURE';
}

function inferVoiceAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('transcri')) return 'TRANSCRIBE';
  if (desc.includes('action item') || desc.includes('follow up') || desc.includes('todo')) return 'EXTRACT_ACTION_ITEMS';
  if (desc.includes('synthesize') || desc.includes('combine') || desc.includes('merge')) return 'SYNTHESIZE';
  return 'SUMMARIZE_CALL';
}

function extractDataContent(results: Record<string, unknown>): unknown {
  for (const value of Object.values(results)) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object' && ('data' in value || 'rows' in value)) return value;
  }
  return undefined;
}

function extractVoiceContent(results: Record<string, unknown>): string | undefined {
  for (const value of Object.values(results)) {
    if (typeof value === 'string' && value.length > 50) return value;
    if (value && typeof value === 'object' && 'transcript' in value) {
      return String((value as Record<string, unknown>)['transcript']);
    }
  }
  return undefined;
}

function inferCoderAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('review') || desc.includes('audit')) return 'REVIEW_CODE';
  if (desc.includes('debug') || desc.includes('fix') || desc.includes('bug')) return 'DEBUG';
  if (desc.includes('refactor') || desc.includes('clean')) return 'REFACTOR';
  if (desc.includes('architect') || desc.includes('design system')) return 'ARCHITECT';
  if (desc.includes('test') || desc.includes('spec')) return 'GENERATE_TESTS';
  return 'WRITE_CODE';
}

function inferLanguage(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('python')) return 'python';
  if (desc.includes('typescript') || desc.includes(' ts ')) return 'typescript';
  if (desc.includes('javascript') || desc.includes(' js ')) return 'javascript';
  if (desc.includes('rust')) return 'rust';
  if (desc.includes('go ') || desc.includes('golang')) return 'go';
  if (desc.includes('java') && !desc.includes('javascript')) return 'java';
  if (desc.includes('c#') || desc.includes('csharp') || desc.includes('.net')) return 'csharp';
  if (desc.includes('sql')) return 'sql';
  if (desc.includes('react') || desc.includes('next')) return 'typescript';
  return 'typescript';
}

function inferDesignerAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('review') || desc.includes('critique') || desc.includes('feedback')) return 'REVIEW_DESIGN';
  if (desc.includes('wireframe') || desc.includes('sketch') || desc.includes('low-fi')) return 'WIREFRAME';
  if (desc.includes('design system') || desc.includes('component library')) return 'DESIGN_SYSTEM';
  if (desc.includes('audit') || desc.includes('ux review') || desc.includes('usability')) return 'UX_AUDIT';
  if (desc.includes('mockup') || desc.includes('prototype') || desc.includes('hi-fi')) return 'CREATE_MOCKUP';
  return 'DESIGN_UI';
}

function inferStrategyAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('market entry') || desc.includes('expansion') || desc.includes('new market')) return 'MARKET_ENTRY';
  if (desc.includes('competitive') || desc.includes('positioning') || desc.includes('differentiat')) return 'COMPETITIVE_POSITIONING';
  if (desc.includes('vision') || desc.includes('roadmap') || desc.includes('long-term')) return 'VISION_PLANNING';
  if (desc.includes('swot')) return 'SWOT';
  if (desc.includes('okr') || desc.includes('objective') || desc.includes('goal')) return 'OKR_SETTING';
  if (desc.includes('decision') || desc.includes('framework') || desc.includes('evaluate option')) return 'DECISION_FRAMEWORK';
  if (desc.includes('track') || desc.includes('execution') || desc.includes('progress')) return 'TRACK_EXECUTION';
  if (desc.includes('alert') || desc.includes('monitor competitor')) return 'COMPETITIVE_ALERT';
  return 'STRATEGIC_ANALYSIS';
}

function inferMarketingAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('gtm') || desc.includes('go-to-market') || desc.includes('launch')) return 'GTM_STRATEGY';
  if (desc.includes('content') || desc.includes('blog') || desc.includes('editorial')) return 'CONTENT_STRATEGY';
  if (desc.includes('campaign')) return 'CAMPAIGN_PLAN';
  if (desc.includes('brand') || desc.includes('identity') || desc.includes('voice')) return 'BRAND_AUDIT';
  if (desc.includes('seo') || desc.includes('search engine') || desc.includes('keyword')) return 'SEO_ANALYSIS';
  if (desc.includes('social') || desc.includes('linkedin') || desc.includes('twitter')) return 'SOCIAL_STRATEGY';
  if (desc.includes('segment') || desc.includes('persona') || desc.includes('audience')) return 'CUSTOMER_SEGMENTATION';
  if (desc.includes('monitor') || desc.includes('track brand') || desc.includes('mentions')) return 'MONITOR_BRAND';
  if (desc.includes('engage') || desc.includes('community') || desc.includes('reply')) return 'ENGAGE_COMMUNITY';
  if (desc.includes('execute') || desc.includes('run campaign') || desc.includes('launch')) return 'EXECUTE_CAMPAIGN';
  return 'COMPETITIVE_MESSAGING';
}

function inferTechnicalAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('tech stack') || desc.includes('technology choice') || desc.includes('compare')) return 'TECH_STACK_EVALUATION';
  if (desc.includes('system design') || desc.includes('microservice') || desc.includes('api design')) return 'SYSTEM_DESIGN';
  if (desc.includes('scal') || desc.includes('performance') || desc.includes('load')) return 'SCALABILITY_ANALYSIS';
  if (desc.includes('security') || desc.includes('vulnerab') || desc.includes('pentest')) return 'SECURITY_AUDIT';
  if (desc.includes('tech debt') || desc.includes('refactor') || desc.includes('legacy')) return 'TECH_DEBT_ASSESSMENT';
  if (desc.includes('infra') || desc.includes('cloud') || desc.includes('deploy') || desc.includes('devops')) return 'INFRASTRUCTURE_PLANNING';
  if (desc.includes('repo') || desc.includes('github') || desc.includes('repository')) return 'ANALYZE_REPO';
  if (desc.includes('depend') || desc.includes('package') || desc.includes('vulnerab')) return 'DEPENDENCY_AUDIT';
  return 'ARCHITECTURE_REVIEW';
}

function inferFinanceAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('model') || desc.includes('projection') || desc.includes('forecast')) return 'FINANCIAL_MODEL';
  if (desc.includes('budget')) return 'BUDGET_ANALYSIS';
  if (desc.includes('revenue') || desc.includes('growth')) return 'REVENUE_FORECAST';
  if (desc.includes('cost') || desc.includes('optimize') || desc.includes('reduce')) return 'COST_OPTIMIZATION';
  if (desc.includes('unit economics') || desc.includes('cac') || desc.includes('ltv')) return 'UNIT_ECONOMICS';
  if (desc.includes('valuation') || desc.includes('dcf') || desc.includes('worth')) return 'VALUATION';
  if (desc.includes('cash flow') || desc.includes('liquidity') || desc.includes('runway')) return 'CASH_FLOW_ANALYSIS';
  if (desc.includes('budget') && desc.includes('track')) return 'TRACK_BUDGET';
  if (desc.includes('parse') || desc.includes('import') || desc.includes('statement') || desc.includes('csv')) return 'PARSE_STATEMENTS';
  return 'RISK_ASSESSMENT';
}

function inferHRAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('job description') || desc.includes('jd') || desc.includes('role description')) return 'JOB_DESCRIPTION';
  if (desc.includes('interview') || desc.includes('hiring plan')) return 'INTERVIEW_PLAN';
  if (desc.includes('policy') || desc.includes('handbook') || desc.includes('guideline')) return 'POLICY_DRAFT';
  if (desc.includes('compensation') || desc.includes('salary') || desc.includes('pay')) return 'COMPENSATION_ANALYSIS';
  if (desc.includes('performance') || desc.includes('review') || desc.includes('feedback')) return 'PERFORMANCE_REVIEW';
  if (desc.includes('culture') || desc.includes('engagement') || desc.includes('survey')) return 'CULTURE_ASSESSMENT';
  if (desc.includes('onboarding') || desc.includes('new hire')) return 'ONBOARDING_PLAN';
  if (desc.includes('screen') || desc.includes('resume') || desc.includes('candidate')) return 'SCREEN_CANDIDATES';
  if (desc.includes('offer') || desc.includes('letter')) return 'GENERATE_OFFER';
  return 'TRAINING_PROGRAM';
}

function inferGrowthAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('enrich') && desc.includes('contact')) return 'LEAD_ENRICHMENT';
  if (desc.includes('enrich') && desc.includes('company')) return 'LEAD_ENRICHMENT';
  if (desc.includes('score') || desc.includes('qualify')) return 'LEAD_SCORING';
  if (desc.includes('dedup') || desc.includes('duplicate')) return 'CONTACT_DEDUP';
  if (desc.includes('verify') && desc.includes('email')) return 'EMAIL_VERIFICATION';
  if (desc.includes('seo') && desc.includes('audit')) return 'SEO_AUDIT';
  if (desc.includes('keyword')) return 'KEYWORD_RESEARCH';
  if (desc.includes('serp') || desc.includes('search result')) return 'SERP_ANALYSIS';
  if (desc.includes('ranking') || desc.includes('position')) return 'RANKING_MONITOR';
  if (desc.includes('sequence') || desc.includes('drip')) return 'EMAIL_SEQUENCE';
  if (desc.includes('personalize') || desc.includes('template')) return 'EMAIL_PERSONALIZATION';
  if (desc.includes('engagement')) return 'ENGAGEMENT_ANALYSIS';
  if (desc.includes('churn') || desc.includes('retention')) return 'CHURN_PREDICTION';
  if (desc.includes('win back') || desc.includes('winback') || desc.includes('re-engage')) return 'WINBACK_CAMPAIGN';
  if (desc.includes('signal') || desc.includes('funding') || desc.includes('hiring')) return 'SIGNAL_MONITORING';
  if (desc.includes('decision maker') || desc.includes('stakeholder')) return 'DECISION_MAKER_SEARCH';
  if (desc.includes('reddit') && (desc.includes('engage') || desc.includes('reply'))) return 'REDDIT_ENGAGEMENT';
  if (desc.includes('twitter') && (desc.includes('engage') || desc.includes('reply'))) return 'TWITTER_ENGAGEMENT';
  if (desc.includes('pipeline') || desc.includes('track lead')) return 'PIPELINE_TRACKING';
  if (desc.includes('lead') || desc.includes('prospect')) return 'LEAD_ENRICHMENT';
  return 'LEAD_ENRICHMENT';
}

function inferContentAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('blog') || desc.includes('article') || desc.includes('long-form')) return 'WRITE_BLOG';
  if (desc.includes('social') || desc.includes('linkedin') || desc.includes('twitter') || desc.includes('post')) return 'WRITE_SOCIAL';
  if (desc.includes('newsletter') || desc.includes('digest') || desc.includes('email blast')) return 'WRITE_NEWSLETTER';
  if (desc.includes('press release') || desc.includes('announcement')) return 'WRITE_PRESS_RELEASE';
  if (desc.includes('script') || desc.includes('video') || desc.includes('podcast')) return 'WRITE_SCRIPT';
  if (desc.includes('optimiz') && desc.includes('seo')) return 'OPTIMIZE_SEO_CONTENT';
  if (desc.includes('repurpose') || desc.includes('adapt') || desc.includes('convert')) return 'REPURPOSE_CONTENT';
  return 'WRITE_BLOG';
}

function inferSEOAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('link') || desc.includes('backlink')) return 'BUILD_LINK_STRATEGY';
  if (desc.includes('technical') || desc.includes('crawl') || desc.includes('sitemap')) return 'FIX_TECHNICAL_SEO';
  if (desc.includes('meta') || desc.includes('title tag')) return 'OPTIMIZE_META_TAGS';
  if (desc.includes('schema') || desc.includes('structured data') || desc.includes('json-ld')) return 'CREATE_SCHEMA_MARKUP';
  if (desc.includes('competitor')) return 'ANALYZE_COMPETITORS_SEO';
  if (desc.includes('gap') || desc.includes('missing')) return 'CONTENT_GAP_ANALYSIS';
  return 'OPTIMIZE_PAGE';
}

function inferPRAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('press release')) return 'DRAFT_PRESS_RELEASE';
  if (desc.includes('pitch') || desc.includes('outreach')) return 'CREATE_MEDIA_PITCH';
  if (desc.includes('crisis')) return 'CRISIS_RESPONSE';
  if (desc.includes('analyst') || desc.includes('briefing')) return 'ANALYST_BRIEFING';
  if (desc.includes('statement') || desc.includes('public')) return 'PUBLIC_STATEMENT';
  if (desc.includes('media list') || desc.includes('journalist')) return 'MEDIA_LIST_BUILD';
  return 'DRAFT_PRESS_RELEASE';
}

function inferLegalAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('review') && desc.includes('contract')) return 'REVIEW_CONTRACT';
  if (desc.includes('nda') || desc.includes('non-disclosure')) return 'DRAFT_NDA';
  if (desc.includes('terms') || desc.includes('tos') || desc.includes('terms of service')) return 'DRAFT_TERMS';
  if (desc.includes('privacy') || desc.includes('gdpr') || desc.includes('ccpa')) return 'DRAFT_PRIVACY_POLICY';
  if (desc.includes('compliance') || desc.includes('checklist') || desc.includes('audit')) return 'COMPLIANCE_CHECKLIST';
  if (desc.includes('risk')) return 'RISK_ASSESSMENT';
  if (desc.includes('regulat')) return 'REGULATORY_RESEARCH';
  if (desc.includes('compare') && desc.includes('contract')) return 'COMPARE_CONTRACTS';
  if (desc.includes('obligation') || desc.includes('deadline') || desc.includes('extract term')) return 'EXTRACT_OBLIGATIONS';
  if (desc.includes('monitor') && desc.includes('regulat')) return 'MONITOR_REGULATIONS';
  return 'REVIEW_CONTRACT';
}

function inferSuccessAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('health') || desc.includes('score')) return 'SCORE_HEALTH';
  if (desc.includes('churn') || desc.includes('at risk')) return 'PREDICT_CHURN';
  if (desc.includes('onboard')) return 'PLAN_ONBOARDING';
  if (desc.includes('renew') || desc.includes('retention')) return 'RENEWAL_STRATEGY';
  if (desc.includes('upsell') || desc.includes('expand') || desc.includes('cross-sell')) return 'IDENTIFY_UPSELL';
  if (desc.includes('qbr') || desc.includes('quarterly') || desc.includes('review')) return 'QUARTERLY_REVIEW';
  if (desc.includes('playbook')) return 'SUCCESS_PLAYBOOK';
  if (desc.includes('track health') || desc.includes('health over time') || desc.includes('health trend')) return 'TRACK_HEALTH_OVER_TIME';
  if (desc.includes('qbr') || desc.includes('quarterly business')) return 'GENERATE_QBR';
  return 'SCORE_HEALTH';
}

function inferAnalyticsAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('metric') || desc.includes('kpi') || desc.includes('calculate')) return 'CALCULATE_METRICS';
  if (desc.includes('trend')) return 'TREND_ANALYSIS';
  if (desc.includes('anomal') || desc.includes('outlier') || desc.includes('spike')) return 'ANOMALY_DETECTION';
  if (desc.includes('a/b') || desc.includes('experiment') || desc.includes('test')) return 'AB_TEST_ANALYSIS';
  if (desc.includes('cohort')) return 'COHORT_ANALYSIS';
  if (desc.includes('dashboard')) return 'BUILD_DASHBOARD';
  if (desc.includes('insight') || desc.includes('report')) return 'GENERATE_INSIGHT_REPORT';
  return 'CALCULATE_METRICS';
}

function inferProductAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('spec') || desc.includes('prd') || desc.includes('requirement doc')) return 'WRITE_SPEC';
  if (desc.includes('user stor') || desc.includes('acceptance criteria')) return 'WRITE_USER_STORIES';
  if (desc.includes('roadmap')) return 'PLAN_ROADMAP';
  if (desc.includes('requirement') || desc.includes('gather')) return 'GATHER_REQUIREMENTS';
  if (desc.includes('sprint')) return 'SPRINT_PLAN';
  if (desc.includes('priorit') || desc.includes('rank') || desc.includes('rice')) return 'FEATURE_PRIORITIZE';
  if (desc.includes('competit')) return 'COMPETITIVE_FEATURE_ANALYSIS';
  return 'WRITE_SPEC';
}

function inferProjectAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('timeline') || desc.includes('estimate') || desc.includes('duration') || desc.includes('pert')) return 'ESTIMATE_TIMELINE';
  if (desc.includes('resource') || desc.includes('allocat') || desc.includes('capacity')) return 'ALLOCATE_RESOURCES';
  if (desc.includes('status') || desc.includes('report') || desc.includes('update')) return 'STATUS_REPORT';
  if (desc.includes('risk')) return 'RISK_REGISTER';
  if (desc.includes('milestone')) return 'MILESTONE_PLAN';
  if (desc.includes('depend') || desc.includes('block')) return 'DEPENDENCY_MAP';
  if (desc.includes('retro') || desc.includes('lessons')) return 'RETROSPECTIVE';
  return 'STATUS_REPORT';
}

function extractCompanyFromDescription(description: string): string | undefined {
  // Try to extract company name from common patterns like "at <Company>" or "for <Company>"
  const match = description.match(/(?:at|for|about|company)\s+([A-Z][A-Za-z0-9.&\- ]+)/);
  return match?.[1]?.trim();
}

function extractKeywordFromDescription(description: string): string | undefined {
  const match = description.match(/(?:keyword|term|query|search for)\s+"?([^"]+)"?/i);
  return match?.[1]?.trim();
}

function extractUrlFromDescription(description: string): string | undefined {
  const match = description.match(/https?:\/\/[^\s]+/);
  return match?.[0];
}

// ─── Vibe Coding Action Inference ──────────────────────────────────────────

function inferAppArchitectAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('schema') || desc.includes('database') || desc.includes('model')) return 'DESIGN_SCHEMA';
  if (desc.includes('route') || desc.includes('page') || desc.includes('navigation')) return 'PLAN_ROUTES';
  if (desc.includes('component') || desc.includes('ui') || desc.includes('layout')) return 'PLAN_COMPONENTS';
  if (desc.includes('change') || desc.includes('modify') || desc.includes('update') || desc.includes('add')) return 'PLAN_CHANGES';
  return 'ARCHITECT_APP';
}

function inferAppGeneratorAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('modify') || desc.includes('change') || desc.includes('update') || desc.includes('fix')) return 'MODIFY_FILE';
  if (desc.includes('component') || desc.includes('button') || desc.includes('form')) return 'GENERATE_COMPONENT';
  if (desc.includes('batch') || desc.includes('multiple') || desc.includes('all files')) return 'GENERATE_BATCH';
  return 'GENERATE_FILE';
}

function inferAppDebuggerAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('type') || desc.includes('typescript') || desc.includes('ts')) return 'FIX_TYPE_ERROR';
  if (desc.includes('runtime') || desc.includes('crash') || desc.includes('undefined')) return 'FIX_RUNTIME_ERROR';
  if (desc.includes('loop') || desc.includes('auto') || desc.includes('self')) return 'SELF_DEBUG_LOOP';
  return 'DIAGNOSE_BUILD_ERROR';
}

function inferAppDeployerAction(task: import('@jak-swarm/shared').WorkflowTask): string {
  const desc = task.description.toLowerCase();
  if (desc.includes('github') || desc.includes('repo') || desc.includes('push') || desc.includes('sync')) return 'SYNC_GITHUB';
  if (desc.includes('domain') || desc.includes('dns') || desc.includes('custom')) return 'CONFIGURE_DOMAIN';
  if (desc.includes('preview') || desc.includes('staging')) return 'DEPLOY_PREVIEW';
  if (desc.includes('status') || desc.includes('check')) return 'CHECK_DEPLOYMENT_STATUS';
  return 'DEPLOY_VERCEL';
}
