export enum AgentRole {
  COMMANDER = 'COMMANDER',
  PLANNER = 'PLANNER',
  ROUTER = 'ROUTER',
  VERIFIER = 'VERIFIER',
  GUARDRAIL = 'GUARDRAIL',
  APPROVAL = 'APPROVAL',
  WORKER_EMAIL = 'WORKER_EMAIL',
  WORKER_CALENDAR = 'WORKER_CALENDAR',
  WORKER_CRM = 'WORKER_CRM',
  WORKER_DOCUMENT = 'WORKER_DOCUMENT',
  WORKER_SPREADSHEET = 'WORKER_SPREADSHEET',
  WORKER_BROWSER = 'WORKER_BROWSER',
  WORKER_RESEARCH = 'WORKER_RESEARCH',
  WORKER_KNOWLEDGE = 'WORKER_KNOWLEDGE',
  WORKER_SUPPORT = 'WORKER_SUPPORT',
  WORKER_OPS = 'WORKER_OPS',
  WORKER_VOICE = 'WORKER_VOICE',
  // Expert / Executive roles
  WORKER_CODER = 'WORKER_CODER',
  WORKER_DESIGNER = 'WORKER_DESIGNER',
  WORKER_STRATEGIST = 'WORKER_STRATEGIST',   // CEO-level strategic thinking
  WORKER_MARKETING = 'WORKER_MARKETING',     // CMO-level marketing & GTM
  WORKER_TECHNICAL = 'WORKER_TECHNICAL',     // CTO-level architecture & tech decisions
  WORKER_FINANCE = 'WORKER_FINANCE',         // CFO-level financial analysis & modeling
  WORKER_HR = 'WORKER_HR',                   // HR — hiring, culture, policies
  WORKER_GROWTH = 'WORKER_GROWTH',           // Growth engine — lead gen, SEO, outreach, retention
  // Full autonomous company roles
  WORKER_CONTENT = 'WORKER_CONTENT',         // Content creation — blogs, social, newsletters, scripts
  WORKER_SEO = 'WORKER_SEO',                 // SEO specialist — page optimization, technical SEO, link strategy
  WORKER_PR = 'WORKER_PR',                   // PR & Communications — press releases, media, crisis comms
  WORKER_LEGAL = 'WORKER_LEGAL',             // Legal & Compliance — contracts, NDAs, policies, risk
  WORKER_SUCCESS = 'WORKER_SUCCESS',         // Customer Success — health scoring, onboarding, renewal
  WORKER_ANALYTICS = 'WORKER_ANALYTICS',     // Data Analytics/BI — metrics, trends, dashboards, A/B tests
  WORKER_PRODUCT = 'WORKER_PRODUCT',         // Product Manager — specs, roadmap, user stories, prioritization
  WORKER_PROJECT = 'WORKER_PROJECT',         // Project Manager — timelines, resources, status, milestones
  // Vibe Coding — full-stack app generation agents
  WORKER_APP_ARCHITECT = 'WORKER_APP_ARCHITECT',       // App architecture from natural language
  WORKER_APP_GENERATOR = 'WORKER_APP_GENERATOR',       // Code file generation from architecture
  WORKER_APP_DEBUGGER = 'WORKER_APP_DEBUGGER',         // Self-debugging loop for build errors
  WORKER_APP_DEPLOYER = 'WORKER_APP_DEPLOYER',         // Deploy to Vercel, sync GitHub
  WORKER_SCREENSHOT_TO_CODE = 'WORKER_SCREENSHOT_TO_CODE', // Image/screenshot to code conversion
}

export enum AgentStatus {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  WAITING_APPROVAL = 'WAITING_APPROVAL',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export interface AgentHandoff {
  fromAgent: AgentRole;
  toAgent: AgentRole;
  reason: string;
  context: Record<string, unknown>;
  timestamp: Date;
}

export interface ToolCall {
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  error?: string;
}

export interface AgentTrace {
  traceId: string;
  runId: string;
  agentRole: AgentRole;
  stepIndex: number;
  input: unknown;
  output: unknown;
  toolCalls: ToolCall[];
  handoffs: AgentHandoff[];
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  costUsd?: number;
  error?: string;
}
