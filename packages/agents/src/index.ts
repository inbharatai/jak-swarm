// Base
export { AgentContext } from './base/agent-context.js';
export type { AgentContextParams } from './base/agent-context.js';
export { BaseAgent } from './base/base-agent.js';
export type { ToolLoopResult } from './base/base-agent.js';

// LLM Providers
export type { LLMProvider, LLMResponse, TextContent, ImageContent, MessageContent } from './base/llm-provider.js';
export { OpenAIProvider } from './base/providers/openai-provider.js';
export { AnthropicProvider } from './base/providers/anthropic-provider.js';
export { ProviderRouter, getDefaultProvider } from './base/provider-router.js';
export { GeminiProvider } from './base/providers/gemini-provider.js';
export { DeepSeekProvider } from './base/providers/deepseek-provider.js';
export { OllamaProvider } from './base/providers/ollama-provider.js';
export { OpenRouterProvider } from './base/providers/openrouter-provider.js';

// Anti-hallucination & optimization utilities
export {
  fullHallucinationCheck,
  detectInventedStatistics,
  detectFabricatedSources,
  detectOverconfidence,
  detectImpossibleClaims,
  groundingCheck,
} from './base/anti-hallucination.js';

export {
  estimateTokens,
  compressContext,
  selectModel,
} from './base/token-optimizer.js';

// Orchestrator agents
export { CommanderAgent } from './roles/commander.agent.js';
export type { MissionBrief, CommanderOutput } from './roles/commander.agent.js';

export { PlannerAgent } from './roles/planner.agent.js';
export type { PlannerOutput } from './roles/planner.agent.js';

export { RouterAgent } from './roles/router.agent.js';
export type { RouteMap, RouterOutput } from './roles/router.agent.js';

export { VerifierAgent } from './roles/verifier.agent.js';
export type { VerificationResult, VerifierInput } from './roles/verifier.agent.js';

export { GuardrailAgent } from './roles/guardrail.agent.js';
export type { GuardrailResult, GuardrailInput } from './roles/guardrail.agent.js';

export { ApprovalAgent } from './roles/approval.agent.js';
export type { ApprovalInput } from './roles/approval.agent.js';

// Worker agents
export { EmailAgent } from './workers/email.agent.js';
export type {
  EmailAction,
  EmailTask,
  EmailMessage,
  EmailResult,
  EmailFilter,
} from './workers/email.agent.js';

export { DocumentAgent } from './workers/document.agent.js';
export type {
  DocumentAction,
  DocumentTask,
  DocumentResult,
  ExtractionField,
} from './workers/document.agent.js';

export { ResearchAgent } from './workers/research.agent.js';
export type { ResearchTask, ResearchResult, ResearchSource } from './workers/research.agent.js';

export { BrowserAgent } from './workers/browser.agent.js';
export type {
  BrowserAction,
  BrowserTask,
  BrowserResult,
} from './workers/browser.agent.js';

export { SupportAgent } from './workers/support.agent.js';
export type {
  SupportAction,
  SupportTask,
  SupportResult,
  SupportClassification,
  SupportCategory,
  SupportSentiment,
} from './workers/support.agent.js';

export { CalendarAgent } from './workers/calendar.agent.js';
export type { CalendarTask, CalendarResult } from './workers/calendar.agent.js';

export { CRMAgent } from './workers/crm.agent.js';
export type { CRMTask, CRMResult } from './workers/crm.agent.js';

export { SpreadsheetAgent } from './workers/spreadsheet.agent.js';
export type { SpreadsheetTask, SpreadsheetResult } from './workers/spreadsheet.agent.js';

export { OpsAgent } from './workers/ops.agent.js';
export type { OpsTask, OpsResult } from './workers/ops.agent.js';

export { VoiceAgent } from './workers/voice.agent.js';
export type { VoiceTask, VoiceResult } from './workers/voice.agent.js';

export { KnowledgeAgent } from './workers/knowledge.agent.js';
export type { KnowledgeTask, KnowledgeResult } from './workers/knowledge.agent.js';

// Expert / Executive agents
export { CoderAgent } from './workers/coder.agent.js';
export type { CoderTask, CoderResult } from './workers/coder.agent.js';

export { DesignerAgent } from './workers/designer.agent.js';
export type { DesignerTask, DesignerResult } from './workers/designer.agent.js';

export { StrategistAgent } from './workers/strategist.agent.js';
export type { StrategistTask, StrategistResult } from './workers/strategist.agent.js';

export { MarketingAgent } from './workers/marketing.agent.js';
export type { MarketingTask, MarketingResult } from './workers/marketing.agent.js';

export { TechnicalAgent } from './workers/technical.agent.js';
export type { TechnicalTask, TechnicalResult } from './workers/technical.agent.js';

export { FinanceAgent } from './workers/finance.agent.js';
export type { FinanceTask, FinanceResult } from './workers/finance.agent.js';

export { HRAgent } from './workers/hr.agent.js';
export type { HRTask, HRResult } from './workers/hr.agent.js';

export { GrowthAgent } from './workers/growth.agent.js';
export type { GrowthAction, GrowthTask, GrowthResult } from './workers/growth.agent.js';

// Autonomous company agents
export { ContentAgent } from './workers/content.agent.js';
export type { ContentAction, ContentTask, ContentResult } from './workers/content.agent.js';

export { SEOAgent } from './workers/seo.agent.js';
export type { SEOAction, SEOTask, SEOResult } from './workers/seo.agent.js';

export { PRAgent } from './workers/pr.agent.js';
export type { PRAction, PRTask, PRResult } from './workers/pr.agent.js';

export { LegalAgent } from './workers/legal.agent.js';
export type { LegalAction, LegalTask, LegalResult } from './workers/legal.agent.js';

export { SuccessAgent } from './workers/success.agent.js';
export type { SuccessAction, SuccessTask, SuccessResult } from './workers/success.agent.js';

export { AnalyticsAgent } from './workers/analytics.agent.js';
export type { AnalyticsAction, AnalyticsTask, AnalyticsResult } from './workers/analytics.agent.js';

export { ProductAgent } from './workers/product.agent.js';
export type { ProductAction, ProductTask, ProductResult } from './workers/product.agent.js';

export { ProjectAgent } from './workers/project.agent.js';
export type { ProjectAction, ProjectTask, ProjectResult } from './workers/project.agent.js';

// Vibe Coding agents
export { AppArchitectAgent } from './workers/app-architect.agent.js';
export type { AppArchitectAction, AppArchitectTask, AppArchitectResult } from './workers/app-architect.agent.js';

export { AppGeneratorAgent } from './workers/app-generator.agent.js';
export type { AppGeneratorAction, AppGeneratorTask, AppGeneratorResult } from './workers/app-generator.agent.js';

export { AppDebuggerAgent } from './workers/app-debugger.agent.js';
export type { AppDebuggerAction, AppDebuggerTask, AppDebuggerResult } from './workers/app-debugger.agent.js';

export { AppDeployerAgent } from './workers/app-deployer.agent.js';
export type { AppDeployerAction, AppDeployerTask, AppDeployerResult } from './workers/app-deployer.agent.js';

export { ScreenshotToCodeAgent } from './workers/screenshot-to-code.agent.js';
export type { ScreenshotToCodeAction, ScreenshotToCodeTask, ScreenshotToCodeResult } from './workers/screenshot-to-code.agent.js';
