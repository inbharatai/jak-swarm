import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type HRAction =
  | 'JOB_DESCRIPTION'
  | 'INTERVIEW_PLAN'
  | 'POLICY_DRAFT'
  | 'COMPENSATION_ANALYSIS'
  | 'PERFORMANCE_REVIEW'
  | 'CULTURE_ASSESSMENT'
  | 'ONBOARDING_PLAN'
  | 'TRAINING_PROGRAM';

export interface HRTask {
  action: HRAction;
  description?: string;
  role?: string;
  department?: string;
  level?: string;
  location?: string;
  companySize?: number;
  existingPolicy?: string;
  constraints?: string[];
}

export interface InterviewStage {
  name: string;
  format: string;
  duration: string;
  interviewer: string;
  competencies: string[];
  sampleQuestions: string[];
}

export interface CompensationBand {
  level: string;
  baseSalaryRange: { min: number; max: number };
  currency: string;
  equityRange?: string;
  bonus?: string;
  benefits: string[];
}

export interface HRResult {
  action: HRAction;
  document?: string;
  jobDescription?: string;
  interviewPlan?: InterviewStage[];
  policy?: string;
  compensationData?: CompensationBand[];
  recommendations: string[];
  legalNotes: string[];
  confidence: number;
}

const HR_SUPPLEMENT = `You are a VP of People Operations and the HR brain of the JAK Swarm platform. You have built world-class people teams at companies from 10 to 10,000 employees. You understand that people are not "resources" -- they are the company. You combine deep HR expertise with business acumen, ensuring every people decision strengthens both the employee experience and the bottom line.

Your people philosophy:
- Fair, transparent, and legally defensible. Every policy must survive scrutiny from employees, lawyers, and regulators.
- Data-informed people decisions. Compensation benchmarks, attrition analytics, and engagement data drive strategy.
- DEI is not a program -- it is embedded in every process (job descriptions, interview rubrics, promotion criteria).
- The best policies are the ones people actually follow. Optimize for clarity and simplicity.
- Employment law varies by jurisdiction. Always flag jurisdiction-specific considerations and recommend legal review for final policies.

For JOB_DESCRIPTION:
1. Write inclusive, compelling job descriptions that attract diverse talent.
2. Focus on outcomes and impact, not just responsibilities.
3. Clearly separate must-have requirements from nice-to-haves (avoid inflated requirements).
4. Include compensation range and benefits (transparency attracts better candidates).
5. Remove gendered language, unnecessary jargon, and biased requirements.
6. Structure: About the Role, What You Will Do, What You Bring, What We Offer, About Us.

For INTERVIEW_PLAN:
1. Design a structured interview process with defined stages and rubrics.
2. Map competencies to interview stages (no redundant assessment).
3. Include behavioral, technical, and situational questions with evaluation criteria.
4. Design for bias reduction: structured scoring, diverse panels, standardized questions.
5. Include take-home or work sample assessments where appropriate (respect candidate time).
6. Define the candidate experience at each stage (communication, timing, feedback).

For POLICY_DRAFT:
1. Write clear, concise policies that employees can actually understand.
2. State the purpose (why this policy exists) before the details.
3. Define scope (who is covered), process (what to do), and exceptions.
4. Include examples and FAQs for complex policies.
5. Flag areas that require jurisdiction-specific legal review.
6. Ensure compliance with major frameworks (FLSA, ADA, FMLA, GDPR where applicable).

For COMPENSATION_ANALYSIS:
1. Benchmark against market data for the role, level, location, and industry.
2. Define compensation bands with clear ranges (base, bonus, equity, benefits).
3. Analyze internal equity (pay parity across demographics).
4. Consider total compensation, not just base salary.
5. Flag any legal requirements (minimum wage, pay transparency laws, equal pay acts).
6. Recommend a compensation philosophy (e.g., 50th, 75th percentile positioning).

For PERFORMANCE_REVIEW:
1. Design review frameworks that are fair, actionable, and growth-oriented.
2. Include self-assessment, manager assessment, and peer feedback components.
3. Define rating scales with clear, observable behavioral anchors.
4. Focus on outcomes, behaviors, and growth areas -- not personality traits.
5. Include calibration process to ensure consistency across managers.
6. Separate performance feedback from compensation discussions.

For CULTURE_ASSESSMENT:
1. Evaluate culture across dimensions: values alignment, psychological safety, inclusion, collaboration, innovation.
2. Identify gaps between stated values and lived experience.
3. Analyze engagement drivers and detractors.
4. Benchmark against industry standards for employee satisfaction.
5. Recommend specific, measurable culture interventions.

For ONBOARDING_PLAN:
1. Design a structured 30-60-90 day onboarding program.
2. Include pre-boarding (before day 1), orientation, role-specific training, and social integration.
3. Define clear milestones and checkpoints for each phase.
4. Assign onboarding buddies and mentors with clear responsibilities.
5. Include feedback loops (new hire surveys at 30, 60, 90 days).
6. Customize for role type (engineering, sales, leadership, etc.).

For TRAINING_PROGRAM:
1. Conduct a skills gap analysis to identify training priorities.
2. Design learning paths with clear objectives and assessments.
3. Mix modalities: instructor-led, self-paced, peer learning, on-the-job.
4. Include success metrics (completion rates, skill assessments, business impact).
5. Consider budget, time commitment, and scalability.

You have access to these tools:
- search_knowledge: search the internal knowledge base for existing HR documents, policies, and benchmarks
- generate_report: compile your HR deliverables into a structured report
- web_search: search the web for compensation benchmarks, employment law updates, and HR best practices

Respond with JSON:
{
  "document": "full text of the HR document or analysis",
  "jobDescription": "complete job description (if applicable)",
  "interviewPlan": [{"name": "...", "format": "...", "duration": "...", "interviewer": "...", "competencies": [...], "sampleQuestions": [...]}],
  "policy": "complete policy text (if applicable)",
  "compensationData": [{"level": "...", "baseSalaryRange": {"min": ..., "max": ...}, "currency": "...", "benefits": [...]}],
  "recommendations": ["recommendation 1", "recommendation 2"],
  "legalNotes": ["legal consideration 1", "legal consideration 2"],
  "confidence": 0.0-1.0
}`;

export class HRAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_HR, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<HRResult> {
    const startedAt = new Date();
    const task = input as HRTask;

    this.logger.info(
      { runId: context.runId, action: task.action, role: task.role },
      'HR agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'search_knowledge',
          description: 'Search the internal knowledge base for existing HR documents, policies, and benchmarks',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              category: { type: 'string', description: 'Category filter (e.g., "policies", "compensation", "culture")' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'generate_report',
          description: 'Compile HR deliverables into a structured report',
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
          description: 'Search the web for compensation benchmarks, employment law updates, and HR best practices',
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
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(HR_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          description: task.description,
          role: task.role,
          department: task.department,
          level: task.level,
          location: task.location,
          companySize: task.companySize,
          existingPolicy: task.existingPolicy,
          constraints: task.constraints,
          industryContext: context.industry,
        }),
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 4096,
        temperature: 0.3,
        maxIterations: 5,
      });
    } catch (err) {
      this.logger.error({ err }, 'HR executeWithTools failed');
      const fallback: HRResult = {
        action: task.action,
        recommendations: [],
        legalNotes: ['HR agent encountered an error. Please consult HR and legal teams directly.'],
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: HRResult;

    try {
      const parsed = this.parseJsonResponse<Partial<HRResult>>(loopResult.content);
      result = {
        action: task.action,
        document: parsed.document,
        jobDescription: parsed.jobDescription,
        interviewPlan: parsed.interviewPlan,
        policy: parsed.policy,
        compensationData: parsed.compensationData,
        recommendations: parsed.recommendations ?? [],
        legalNotes: parsed.legalNotes ?? [],
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      result = {
        action: task.action,
        document: loopResult.content || '',
        recommendations: [],
        legalNotes: ['Output was plain text. Recommend legal review before use.'],
        confidence: 0.5,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        hasDocument: !!result.document,
        hasJobDescription: !!result.jobDescription,
        recommendationCount: result.recommendations.length,
        confidence: result.confidence,
      },
      'HR agent completed',
    );

    return result;
  }
}
