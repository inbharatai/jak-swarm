import { AgentRole, type WorkflowTask } from '@jak-swarm/shared';
import type { SwarmState } from '../../../state/swarm-state.js';
import { buildBrowserExecutionPlan } from './intent-inference/browser.js';
import {
  extractCompanyFromDescription,
  extractDataContent,
  extractDocumentContent,
  extractKeywordFromDescription,
  extractUrlFromDescription,
  extractVoiceContent,
  inferAnalyticsAction,
  inferAppArchitectAction,
  inferAppDebuggerAction,
  inferAppDeployerAction,
  inferAppGeneratorAction,
  inferCalendarAction,
  inferContentAction,
  inferCRMAction,
  inferCoderAction,
  inferDesignerAction,
  inferDocumentAction,
  inferEmailAction,
  inferFinanceAction,
  inferGrowthAction,
  inferHRAction,
  inferLanguage,
  inferLegalAction,
  inferMarketingAction,
  inferOpsAction,
  inferPRAction,
  inferProductAction,
  inferProjectAction,
  inferSEOAction,
  inferSpreadsheetAction,
  inferStrategyAction,
  inferSuccessAction,
  inferTechnicalAction,
  inferVoiceAction,
} from './intent-inference/text.js';

/**
 * Build the role-specific input payload passed to a worker agent's `execute()` call.
 *
 * Split out of worker-node.ts as part of P5b. Keeping the dispatch table in its own
 * module makes adding a new role a local edit instead of a bigger diff against the
 * orchestration path.
 */
export function buildTaskInput(task: WorkflowTask, state: SwarmState): unknown {
  // Gather results from dependencies
  const dependencyResults: Record<string, unknown> = {};
  for (const depId of task.dependsOn) {
    if (state.taskResults[depId] !== undefined) {
      dependencyResults[depId] = state.taskResults[depId];
    }
  }

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
    case AgentRole.WORKER_BROWSER: {
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
