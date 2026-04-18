import { AgentRole } from '@jak-swarm/shared';
import {
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

/** Minimal surface worker-node depends on from any agent instance. */
export interface WorkerAgent {
  execute(input: unknown, context: unknown): Promise<unknown>;
  reflectAndCorrect(
    outputStr: string,
    taskDescription: string,
    options?: { maxTokens?: number },
  ): Promise<{ corrected: string; wasChanged: boolean }>;
}

/**
 * Construct a worker agent instance for the given role.
 *
 * Split out of worker-node.ts as part of P5b so the role->agent mapping is
 * testable in isolation and adding a new role only touches this file.
 */
export function createWorkerAgent(role: AgentRole): WorkerAgent | null {
  switch (role) {
    case AgentRole.WORKER_EMAIL:
      return new EmailAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_DOCUMENT:
      return new DocumentAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_RESEARCH:
      return new ResearchAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_KNOWLEDGE:
      return new KnowledgeAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_BROWSER:
      return new BrowserAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_SUPPORT:
      return new SupportAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_CALENDAR:
      return new CalendarAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_CRM:
      return new CRMAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_SPREADSHEET:
      return new SpreadsheetAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_OPS:
      return new OpsAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_VOICE:
      return new VoiceAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_CODER:
      return new CoderAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_DESIGNER:
      return new DesignerAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_STRATEGIST:
      return new StrategistAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_MARKETING:
      return new MarketingAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_TECHNICAL:
      return new TechnicalAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_FINANCE:
      return new FinanceAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_HR:
      return new HRAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_GROWTH:
      return new GrowthAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_CONTENT:
      return new ContentAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_SEO:
      return new SEOAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_PR:
      return new PRAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_LEGAL:
      return new LegalAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_SUCCESS:
      return new SuccessAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_ANALYTICS:
      return new AnalyticsAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_PRODUCT:
      return new ProductAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_PROJECT:
      return new ProjectAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_APP_ARCHITECT:
      return new AppArchitectAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_APP_GENERATOR:
      return new AppGeneratorAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_APP_DEBUGGER:
      return new AppDebuggerAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_APP_DEPLOYER:
      return new AppDeployerAgent() as unknown as WorkerAgent;
    case AgentRole.WORKER_SCREENSHOT_TO_CODE:
      return new ScreenshotToCodeAgent() as unknown as WorkerAgent;
    default:
      return null;
  }
}
