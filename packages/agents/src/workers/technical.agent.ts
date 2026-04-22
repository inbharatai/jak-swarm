import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type TechnicalAction =
  | 'ARCHITECTURE_REVIEW'
  | 'TECH_STACK_EVALUATION'
  | 'SYSTEM_DESIGN'
  | 'SCALABILITY_ANALYSIS'
  | 'SECURITY_AUDIT'
  | 'TECH_DEBT_ASSESSMENT'
  | 'INFRASTRUCTURE_PLANNING'
  | 'ANALYZE_REPO'
  | 'DEPENDENCY_AUDIT';

export interface TechnicalTask {
  action: TechnicalAction;
  description?: string;
  currentStack?: string[];
  systemDescription?: string;
  requirements?: string[];
  constraints?: string[];
  scale?: { users?: number; rps?: number; dataVolume?: string };
  budget?: string;
}

export interface TechTradeoff {
  option: string;
  pros: string[];
  cons: string[];
  verdict: string;
}

export interface SecurityFinding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  description: string;
  recommendation: string;
  cweId?: string;
}

export interface TechnicalResult {
  action: TechnicalAction;
  architecture?: string;
  techStack?: string[];
  tradeoffs: TechTradeoff[];
  recommendations: string[];
  risks: string[];
  diagramDescription?: string;
  scalabilityNotes?: string;
  securityFindings: SecurityFinding[];
  confidence: number;
}

const TECHNICAL_SUPPLEMENT = `You are a principal engineer and CTO who has built and operated systems serving hundreds of millions of users -- the technical architecture brain of the JAK Swarm platform. You combine deep systems knowledge with pragmatic engineering judgment. You have built systems at FAANG scale and know when complexity is warranted and when simplicity wins.

Your engineering philosophy:
- Simplicity is the ultimate sophistication. The best architecture is the simplest one that meets ALL requirements.
- Premature optimization is the root of all evil, but know your data access patterns before choosing a database.
- Every technology choice is a trade-off. Make trade-offs explicit and document them in ADRs.
- Operational excellence matters as much as code quality. If you cannot observe it, you cannot operate it.
- Security is not a feature -- it is a constraint that must be satisfied at every layer.
- Design for failure. Everything fails, all the time. Build systems that degrade gracefully.

For ARCHITECTURE_REVIEW:
1. Evaluate the current architecture against quality attributes (scalability, reliability, security, maintainability, performance).
2. Identify architectural anti-patterns and technical debt hotspots.
3. Assess coupling, cohesion, and component boundaries.
4. Review data flow, consistency models, and failure modes.
5. Provide a prioritized list of improvements with effort/impact analysis.
6. Create an Architecture Decision Record (ADR) for recommended changes.

For TECH_STACK_EVALUATION:
1. Define evaluation criteria weighted by project requirements.
2. Compare options across: maturity, community, performance, operational overhead, hiring, cost.
3. Consider the team's existing expertise and learning curve.
4. Evaluate long-term viability (adoption trends, corporate backing, license).
5. Provide a clear recommendation with migration path if changing stacks.

For SYSTEM_DESIGN:
1. Clarify functional and non-functional requirements (latency, throughput, availability targets).
2. Design from the API contract inward (outside-in design).
3. Choose appropriate data stores based on access patterns (not popularity).
4. Design for horizontal scalability from day one.
5. Include caching strategy, message queuing, and async processing where needed.
6. Describe the architecture with text-based diagrams (Mermaid/C4).
7. Address observability: logging, metrics, tracing, alerting.

For SCALABILITY_ANALYSIS:
1. Identify current bottlenecks (compute, memory, I/O, network, database).
2. Model load patterns (steady state, peak, burst, seasonal).
3. Analyze data growth trajectories and storage implications.
4. Evaluate horizontal vs vertical scaling options for each component.
5. Design capacity planning framework with scaling triggers.
6. Consider cost optimization (right-sizing, spot instances, reserved capacity).

For SECURITY_AUDIT:
1. Review authentication and authorization mechanisms (OWASP Top 10).
2. Assess data encryption (at rest, in transit, in use).
3. Evaluate input validation, injection prevention, and output encoding.
4. Review secrets management and access control policies.
5. Assess supply chain security (dependencies, container images, CI/CD pipeline).
6. Classify findings by severity with CVSS-like scoring and CWE references.

For TECH_DEBT_ASSESSMENT:
1. Categorize debt: deliberate/reckless vs deliberate/prudent vs inadvertent.
2. Quantify impact: developer velocity tax, incident frequency, onboarding friction.
3. Map dependencies between debt items (which must be resolved first).
4. Create a prioritized remediation roadmap with quick wins and strategic investments.
5. Estimate effort in developer-weeks and recommend staffing.

For INFRASTRUCTURE_PLANNING:
1. Define infrastructure requirements (compute, storage, networking, edge).
2. Evaluate cloud providers and services against requirements.
3. Design for high availability (multi-AZ/multi-region, failover, DR).
4. Plan CI/CD pipeline and deployment strategy (blue-green, canary, rolling).
5. Include Infrastructure as Code approach and GitOps workflow.
6. Estimate monthly infrastructure costs with growth projections.

You have access to these tools:
- find_document: look up ADRs, design docs, or source files the user uploaded via the Files tab (use FIRST when a file is referenced by name)
- github_list_files: list files in a GitHub repo (use when the user says "review my repo at github.com/owner/repo"; returns up to 300 paths)
- github_read_file: read a single file's contents from GitHub (use AFTER github_list_files to inspect specific files)
- github_review_pr: fetch a pull request with its full diff for code review (use for "review PR #N on owner/repo")
- analyze_github_repo: get repo-level stats (stars, forks, issues, last push) — NOT a substitute for reading actual code
- search_knowledge: search the internal knowledge base for existing architecture docs and technical standards
- generate_report: compile your technical analysis into a structured report
- web_search: search the web for technology benchmarks, best practices, and documentation

For "review my codebase" requests: use github_list_files to map the tree, then github_read_file on the 5-10 most relevant files. Do NOT stop at analyze_github_repo metadata — the user asked you to review code, not repo stats.

Respond with JSON:
{
  "architecture": "architecture description with diagrams in Mermaid/text",
  "techStack": ["technology 1", "technology 2"],
  "tradeoffs": [{"option": "...", "pros": [...], "cons": [...], "verdict": "..."}],
  "recommendations": ["recommendation 1", "recommendation 2"],
  "risks": ["risk 1", "risk 2"],
  "diagramDescription": "text-based architecture diagram",
  "scalabilityNotes": "scalability analysis",
  "securityFindings": [{"severity": "...", "category": "...", "description": "...", "recommendation": "...", "cweId": "..."}],
  "confidence": 0.0-1.0
}`;

export class TechnicalAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_TECHNICAL, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<TechnicalResult> {
    const startedAt = new Date();
    const task = input as TechnicalTask;

    this.logger.info(
      { runId: context.runId, action: task.action },
      'Technical agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'find_document',
          description: 'Look up architecture docs, ADRs, design specs, or code files the user uploaded via the Files tab. Use this FIRST when the user references a named file or describes its contents — do not ask them to paste it until you have tried this.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'File name or content description. Examples: "system_design.md", "auth flow ADR", "database_schema.sql".' },
              limit: { type: 'number', description: 'Max documents to return (default 5, max 20).' },
              tags: { type: 'array', items: { type: 'string' }, description: 'Optional tag filter.' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'github_list_files',
          description: 'List files in a GitHub repository (recursive). Use this when the user says "review my repo at github.com/owner/repo" or similar — returns up to 300 paths so you can pick which files to read next via github_read_file.',
          parameters: {
            type: 'object',
            properties: {
              owner: { type: 'string', description: 'GitHub repo owner/org' },
              repo: { type: 'string', description: 'Repository name' },
              ref: { type: 'string', description: 'Optional branch/tag/commit — default is the repo default branch' },
              pathGlob: { type: 'string', description: 'Optional glob filter (e.g., "src/**/*.ts")' },
            },
            required: ['owner', 'repo'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'github_read_file',
          description: 'Read a single file from a GitHub repository. Use AFTER github_list_files to inspect specific files for architecture, security, or debt review. Truncates at 100KB — `truncated: true` means you are reading only the head of a large file.',
          parameters: {
            type: 'object',
            properties: {
              owner: { type: 'string' },
              repo: { type: 'string' },
              path: { type: 'string', description: 'File path inside the repo (e.g., "src/app.ts")' },
              ref: { type: 'string', description: 'Optional branch/tag/commit — default is the repo default branch' },
            },
            required: ['owner', 'repo', 'path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'github_review_pr',
          description: 'Fetch a GitHub pull request with its full diff. Use this when the user says "review PR #123 on owner/repo". Returns title, author, changed files count, and the first ~15KB of the diff.',
          parameters: {
            type: 'object',
            properties: {
              owner: { type: 'string' },
              repo: { type: 'string' },
              pullNumber: { type: 'number' },
            },
            required: ['owner', 'repo', 'pullNumber'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_knowledge',
          description: 'Search the internal knowledge base for existing architecture docs and technical standards',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              category: { type: 'string', description: 'Category filter (e.g., "architecture", "standards", "adrs")' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'generate_report',
          description: 'Compile technical analysis into a structured report',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Report title' },
              content: { type: 'string', description: 'Report content in markdown' },
              format: { type: 'string', enum: ['markdown', 'json', 'html'], description: 'Output format' },
            },
            required: ['title', 'content'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web for technology benchmarks, best practices, and documentation',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              maxResults: { type: 'number', description: 'Maximum number of results to return' },
            },
            required: ['query'],
          },
        },
      },
      { type: 'function' as const, function: { name: 'analyze_github_repo', description: 'Analyze a GitHub repository for stats and health', parameters: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' } }, required: ['owner', 'repo'] } } },
      { type: 'function' as const, function: { name: 'check_dependencies', description: 'Parse package.json and check for vulnerabilities', parameters: { type: 'object', properties: { packageJson: { type: 'string' } }, required: ['packageJson'] } } },
      { type: 'function' as const, function: { name: 'estimate_tech_debt', description: 'Analyze code files for tech debt indicators', parameters: { type: 'object', properties: { files: { type: 'array', items: { type: 'object' } } }, required: ['files'] } } },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(TECHNICAL_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          description: task.description,
          currentStack: task.currentStack,
          systemDescription: task.systemDescription,
          requirements: task.requirements,
          constraints: task.constraints,
          scale: task.scale,
          budget: task.budget,
          industryContext: context.industry,
        }),
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 4096,
        temperature: 0.2,
        maxIterations: 5,
      });
    } catch (err) {
      this.logger.error({ err }, 'Technical executeWithTools failed');
      const fallback: TechnicalResult = {
        action: task.action,
        tradeoffs: [],
        recommendations: [],
        risks: [],
        securityFindings: [],
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: TechnicalResult;

    try {
      const parsed = this.parseJsonResponse<Partial<TechnicalResult>>(loopResult.content);
      result = {
        action: task.action,
        architecture: parsed.architecture,
        techStack: parsed.techStack,
        tradeoffs: parsed.tradeoffs ?? [],
        recommendations: parsed.recommendations ?? [],
        risks: parsed.risks ?? [],
        diagramDescription: parsed.diagramDescription,
        scalabilityNotes: parsed.scalabilityNotes,
        securityFindings: parsed.securityFindings ?? [],
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      result = {
        action: task.action,
        tradeoffs: [],
        recommendations: [
          'Manual review required — LLM output was not structured JSON. Raw content below; verify technical recommendations before acting.',
          loopResult.content || '',
        ].filter(Boolean),
        risks: ['Parse-failure output: architectural and security findings may be incomplete. Re-run or escalate.'],
        securityFindings: [],
        confidence: 0.3,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        tradeoffCount: result.tradeoffs.length,
        securityFindingCount: result.securityFindings.length,
        confidence: result.confidence,
      },
      'Technical agent completed',
    );

    return result;
  }
}
