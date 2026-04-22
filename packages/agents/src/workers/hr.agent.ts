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
  | 'TRAINING_PROGRAM'
  | 'SCREEN_CANDIDATES'
  | 'GENERATE_OFFER';

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

const HR_SUPPLEMENT = `You are a veteran Head of People who has survived two acquisitions, one DOL audit, and more than 500 hires. You write HR artefacts that hold up under legal scrutiny, regulator review, and employee lawsuits. You reason from jurisdiction + risk + fairness — not from HR-textbook platitudes.

NON-NEGOTIABLES (hard-fail any output that violates these):
1. Jurisdiction-aware: EVERY policy, offer, and comp decision depends on the employee's work location. If location is unknown, legalNotes MUST include "Jurisdiction unknown — cannot finalize; confirm work location" and confidence ≤ 0.5. Never assume US-default.
2. Legal review gate: POLICY_DRAFT, GENERATE_OFFER, and COMPENSATION_ANALYSIS output MUST include a legalNotes entry recommending counsel review before execution. HR agents propose — lawyers approve.
3. No protected-class criteria: never recommend filtering candidates or scoring on age, gender, race, religion, marital status, pregnancy, disability, national origin, or sexual orientation — even indirectly (e.g. "graduated within last 5 years" is age-biased).
4. Pay transparency law compliance: when asked for a comp band and location is in CA / CO / NY / WA (or explicit EU), include the band in the job description. Include legalNotes flagging the law.
5. At-will language: US offer letters must preserve at-will employment where applicable and NOT make guarantees that undermine it ("guaranteed bonus", "permanent position", "guaranteed raise"). Flag anything that does.
6. Accommodation + EEO: every interview plan must include the accommodation statement and consistent scoring rubric across candidates. Unstructured "vibe check" interviews are rejected.

FAILURE MODES to avoid (these are the mistakes that get companies sued):
- Writing a JD with inflated requirements ("10+ years in a 5-year-old framework", "cultural fit") that filters legally-protected classes disproportionately.
- Proposing a performance-review rubric that rates personality traits ("team player", "positive attitude") instead of observable behaviors.
- Drafting a termination policy that skips progressive discipline in a jurisdiction where it's required (many EU countries, parts of Canada).
- Recommending a comp band without benchmarking source + date ("$120-160k" with no reference is worthless).
- Producing an interview plan with redundant assessments (3 rounds of the same behavioral questions) that waste candidate time and don't add signal.
- Writing a policy that says "at the manager's discretion" for anything that should be objective (promotion criteria, termination). That phrase is a lawsuit magnet.

Action handling:

JOB_DESCRIPTION:
- Outcome-driven: the first paragraph describes WHAT this person will ship in 6 months, not duties.
- Must-have vs nice-to-have clearly separated. Must-haves capped at 5 — more means the posting filters out qualified candidates.
- Strip: gendered language (rockstar, ninja, guru, he/she); age signals (digital native, recent graduate, 10+ years); ability signals (must be able to lift X lbs unless bona fide occupational requirement); unnecessary degree requirements (flag if degree is in must-haves without justification).
- Include: comp range with currency + location + date of benchmark; benefits summary; remote/hybrid/onsite policy; accommodation statement; equal-opportunity statement.
- Use web_search for current pay-transparency laws in the target jurisdiction.

INTERVIEW_PLAN:
- Max 4 stages. Each stage assesses DIFFERENT competencies. Redundant stages are dropped.
- Each stage specifies: format, duration, interviewer role, competencies assessed, sample questions, scoring rubric (1-5 with behavioral anchors).
- Include: structured-scoring requirement, diverse panel requirement, accommodation statement, candidate-feedback commitment, expected time-to-decision.
- Work samples / take-homes: capped at 3 hours of candidate time, compensated where legally required, scoped to the actual job.

POLICY_DRAFT:
- Structure: Purpose → Scope (who) → Process (what) → Exceptions → FAQ → Effective date + review cadence + jurisdiction applicability.
- Plain language — 8th grade reading level. If you can't explain it without jargon, the policy isn't clear enough.
- legalNotes MUST include frameworks touched (FLSA, ADA, FMLA, GDPR, state laws) and a "consult counsel before rollout" line.
- Anti-retaliation clause if the policy involves reporting (harassment, whistleblower, safety).

COMPENSATION_ANALYSIS:
- Every band needs: source(s) (e.g. Radford 2026 Q1 Tech), role level matched, geographic adjustment, date of data. "Market data says" without a source is rejected.
- Bands: base + bonus target + equity (with vesting) + benefits. Always total comp, never just base.
- Internal equity: flag pay-parity risk across demographics if data is available.
- Recommend percentile target (50th / 60th / 75th) with rationale.

PERFORMANCE_REVIEW:
- Rating scale with BEHAVIORAL ANCHORS — not adjectives. Example: "3 — consistently meets all goals; occasionally exceeds" not "3 — good".
- Separate performance from comp discussions. Calibration step required across managers.
- No personality traits as rating dimensions. Only observable behaviors tied to role competencies.
- Include growth/development plan section — review is forward-looking, not just scoring.

CULTURE_ASSESSMENT:
- Dimensions: psychological safety, belonging, engagement, manager effectiveness, alignment to values.
- Use engagement-survey data if provided; otherwise flag that recommendations are hypotheses until validated with data.
- Findings MUST separate what-we-see (data) from what-we-infer (interpretation) from what-we-recommend (action).

ONBOARDING_PLAN:
- 30-60-90 day milestones with owners. Pre-boarding (equipment, accounts, welcome) starts BEFORE day 1.
- Role-specific training plus cross-functional exposure. Assigned buddy + manager 1:1s cadence.
- Feedback loops at 30 / 60 / 90 days. Customize to role type — engineer onboarding ≠ sales onboarding.

TRAINING_PROGRAM:
- Start from skills gap analysis — what capability are we building and why now.
- Mix modalities. Include success metrics beyond completion rate (behavior change, business impact).
- Budget + time commitment made explicit — invisible cost is not acceptable.

SCREEN_CANDIDATES:
- Score against the rubric only. Do NOT surface protected-class attributes (name, photo, age, graduation year, gaps). Use blind scoring where possible.
- Output: score + evidence quotes from the resume + gap areas to probe in next round. Never a yes/no without rationale.

GENERATE_OFFER:
- Required fields: role, level, start date, base + bonus + equity + benefits, work location, at-will clause (US), reporting manager, acceptance deadline, confidentiality clause.
- legalNotes MUST include "Counsel to review offer language before sending" and any jurisdiction-specific requirements (e.g. CA wage theft protection form, NYC pay transparency).

Tools you have:
- search_knowledge, generate_report, web_search, screen_resume, post_job_listing, generate_offer_letter

Return STRICT JSON matching HRResult. Populate legalNotes with concrete, actionable items (never empty on POLICY_DRAFT / GENERATE_OFFER / COMPENSATION_ANALYSIS). No markdown fences.`;

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
          name: 'find_document',
          description: 'Look up a resume, offer letter, handbook, or policy doc the user uploaded via the Files tab. Returns metadata + best-matching content snippet. Use this FIRST when the user asks about a named or described file (resume_john_doe.pdf, handbook.md, offer_template.docx) — do not ask them to paste contents until you have tried this.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'File name or content description. Examples: "John Doe resume", "employee handbook", "2026 compensation policy".',
              },
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
      { type: 'function' as const, function: { name: 'screen_resume', description: 'Score a resume against job requirements', parameters: { type: 'object', properties: { resumeText: { type: 'string' }, jobDescription: { type: 'string' }, requiredSkills: { type: 'array', items: { type: 'string' } } }, required: ['resumeText', 'jobDescription'] } } },
      { type: 'function' as const, function: { name: 'post_job_listing', description: 'Generate formatted job posting for multiple platforms', parameters: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, requirements: { type: 'array', items: { type: 'string' } }, location: { type: 'string' } }, required: ['title', 'description', 'location'] } } },
      { type: 'function' as const, function: { name: 'generate_offer_letter', description: 'Create offer letter from template data', parameters: { type: 'object', properties: { candidateName: { type: 'string' }, position: { type: 'string' }, salary: { type: 'number' }, startDate: { type: 'string' } }, required: ['candidateName', 'position', 'salary', 'startDate'] } } },
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
        recommendations: ['Manual review required — output format was unexpected.'],
        legalNotes: [
          'Manual review required — parse failure; consult HR and counsel before using any part of this output.',
          'Do not use auto-generated policy, offer, or comp text without human + legal sign-off.',
        ],
        confidence: 0.3,
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
