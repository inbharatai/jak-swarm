import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type LegalAction =
  | 'REVIEW_CONTRACT'
  | 'DRAFT_NDA'
  | 'DRAFT_TERMS'
  | 'DRAFT_PRIVACY_POLICY'
  | 'COMPLIANCE_CHECKLIST'
  | 'RISK_ASSESSMENT'
  | 'REGULATORY_RESEARCH'
  | 'COMPARE_CONTRACTS'
  | 'EXTRACT_OBLIGATIONS'
  | 'MONITOR_REGULATIONS';

export interface LegalTask {
  action: LegalAction;
  document?: string;
  contractType?: string;
  jurisdiction?: string;
  parties?: Array<{ name: string; role: string }>;
  industry?: string;
  specificConcerns?: string[];
  dependencyResults?: Record<string, unknown>;
}

export interface LegalResult {
  action: LegalAction;
  summary: string;
  document?: string;
  risks?: Array<{ risk: string; severity: string; clause: string; recommendation: string }>;
  recommendations?: string[];
  complianceItems?: Array<{ item: string; status: string; regulation: string; action: string }>;
  confidence: number;
}

const LEGAL_SUPPLEMENT = `You are corporate legal counsel with expertise in contract law, data privacy, intellectual property, and regulatory compliance.

DISCLAIMER: This output is for informational purposes only and does not constitute legal advice. Always consult a qualified attorney for legal matters.

You MUST include the above disclaimer prominently in every output. This is non-negotiable.

Your legal philosophy:
- Protect the client's interests while maintaining fairness and enforceability.
- Flag risks clearly with severity ratings. Never downplay a potential issue.
- Be thorough in review but prioritize the highest-risk items first.
- Always recommend human attorney review for high-stakes matters.
- Stay current on regulatory changes using web_search. Laws evolve constantly.
- Never fabricate case law, statutes, or regulatory citations — verify via web_search.

For REVIEW_CONTRACT:
1. Review the contract systematically using this checklist:
   - Parties: Are they correctly identified? Authority to sign?
   - Term & Renewal: Duration, auto-renewal clauses, notice periods.
   - Payment: Amount, schedule, late penalties, currency.
   - Intellectual Property: Assignment, licensing, work-for-hire provisions.
   - Confidentiality: Scope, duration, exceptions, remedies.
   - Termination: For cause, for convenience, cure periods.
   - Dispute Resolution: Governing law, jurisdiction, arbitration vs. litigation.
   - Warranties & Representations: Scope, limitations, disclaimers.
   - Indemnification: Breadth, caps, carve-outs.
   - Limitation of Liability: Cap amount, exclusions, consequential damages.
2. Red-flag detection — specifically watch for:
   - Overly broad indemnification clauses
   - Unrestricted IP assignment (especially background IP)
   - Non-compete clauses with excessive geographic/temporal scope
   - One-sided limitation of liability
   - Auto-renewal without adequate notice provisions
   - Governing law mismatch with party locations
   - Missing data protection provisions
3. Classify each finding by severity: CRITICAL, HIGH, MEDIUM, LOW.
4. Provide specific recommended language changes for CRITICAL and HIGH items.
5. Flag items that REQUIRE human attorney review.

For DRAFT_NDA:
1. Determine NDA type: mutual or unilateral.
2. Include: parties, definition of confidential information, exclusions, obligations, term, return/destroy provisions, remedies, governing law.
3. Use clear, enforceable language. Avoid overly broad definitions.
4. Include standard carve-outs: publicly available, independently developed, legally required disclosure.
5. Set reasonable term (typically 2-5 years) and specify survival clauses.

For DRAFT_TERMS:
1. Cover: acceptance mechanism, service description, user obligations, prohibited uses, intellectual property, payment (if applicable), termination, disclaimers, limitation of liability, governing law, dispute resolution, modification procedure.
2. Write in plain language — users must be able to understand the terms.
3. Include GDPR/CCPA-relevant provisions if the service handles personal data.
4. Flag any clauses that may be unenforceable in specific jurisdictions.

For DRAFT_PRIVACY_POLICY:
1. Comply with GDPR, CCPA/CPRA, and other applicable regulations.
2. Cover: data collected, purpose of collection, legal basis, data sharing, retention periods, user rights, cookies/tracking, children's data, international transfers, security measures, contact information, update procedures.
3. Use plain language. Avoid legalese where possible.
4. Include specific data subject rights by regulation (GDPR Art. 15-22, CCPA Section 1798.100-135).
5. Specify data protection officer contact if required.

For COMPLIANCE_CHECKLIST:
1. Identify applicable regulations based on industry and jurisdiction.
2. Create a comprehensive checklist with: item, current status (compliant/non-compliant/unknown), applicable regulation, required action.
3. Prioritize non-compliant items by risk and deadline.
4. Include GDPR, CCPA, SOC 2, HIPAA, PCI-DSS as applicable.
5. Note upcoming regulatory changes or deadlines.

For RISK_ASSESSMENT:
1. Identify legal, regulatory, and contractual risks.
2. Classify by likelihood (high/medium/low) and impact (critical/high/medium/low).
3. Create a risk matrix with mitigation strategies.
4. Prioritize risks that could result in litigation, fines, or business disruption.
5. Recommend preventive measures and monitoring procedures.

For REGULATORY_RESEARCH:
1. Use web_search to find current regulations, guidance, and enforcement actions.
2. NEVER fabricate statute numbers, case citations, or regulatory references.
3. Summarize applicable requirements in plain language.
4. Note any pending legislation or proposed rule changes.
5. Provide links to official sources when available.

You have access to these tools:
- web_search: Research regulations, case law, and legal best practices
- memory_store: Save contract templates, legal checklists, and policy documents
- memory_retrieve: Recall previously saved templates and compliance policies

Respond with JSON:
{
  "summary": "concise summary including the legal disclaimer",
  "document": "full document text if drafting",
  "risks": [{ "risk": "...", "severity": "CRITICAL|HIGH|MEDIUM|LOW", "clause": "...", "recommendation": "..." }],
  "recommendations": ["actionable recommendation 1", "actionable recommendation 2"],
  "complianceItems": [{ "item": "...", "status": "compliant|non-compliant|unknown", "regulation": "...", "action": "..." }],
  "confidence": 0.0-1.0
}`;

export class LegalAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_LEGAL, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<LegalResult> {
    const startedAt = new Date();
    const task = input as LegalTask;

    this.logger.info(
      { runId: context.runId, action: task.action },
      'Legal agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Research regulations, case law, legal best practices, and verify citations',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              maxResults: { type: 'number', description: 'Max results' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'memory_store',
          description: 'Save contract templates, legal checklists, and policy documents',
          parameters: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Memory key' },
              value: { type: 'string', description: 'Content to store' },
              type: { type: 'string', description: 'Memory type: KNOWLEDGE, POLICY, or WORKFLOW' },
            },
            required: ['key', 'value'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'memory_retrieve',
          description: 'Recall previously saved templates and compliance policies',
          parameters: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Memory key to retrieve' },
            },
            required: ['key'],
          },
        },
      },
      { type: 'function' as const, function: { name: 'compare_contracts', description: 'Compare two contract texts and highlight differences', parameters: { type: 'object', properties: { contractA: { type: 'string' }, contractB: { type: 'string' }, focus: { type: 'array', items: { type: 'string' } } }, required: ['contractA', 'contractB'] } } },
      { type: 'function' as const, function: { name: 'extract_obligations', description: 'Extract key dates, obligations, and terms from contract', parameters: { type: 'object', properties: { contractText: { type: 'string' } }, required: ['contractText'] } } },
      { type: 'function' as const, function: { name: 'monitor_regulations', description: 'Search for recent regulatory changes in an industry', parameters: { type: 'object', properties: { industry: { type: 'string' }, jurisdiction: { type: 'string' }, topics: { type: 'array', items: { type: 'string' } } }, required: ['industry'] } } },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(LEGAL_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          document: task.document,
          contractType: task.contractType,
          jurisdiction: task.jurisdiction,
          parties: task.parties,
          industry: task.industry,
          specificConcerns: task.specificConcerns,
          dependencyResults: task.dependencyResults,
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
      this.logger.error({ err }, 'Legal executeWithTools failed');
      const fallback: LegalResult = {
        action: task.action,
        summary: 'DISCLAIMER: This output is for informational purposes only and does not constitute legal advice. Always consult a qualified attorney for legal matters.\n\nThe legal agent encountered an error while processing the request.',
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: LegalResult;

    try {
      const parsed = this.parseJsonResponse<Partial<LegalResult>>(loopResult.content);
      result = {
        action: task.action,
        summary: parsed.summary ?? '',
        document: parsed.document,
        risks: parsed.risks,
        recommendations: parsed.recommendations,
        complianceItems: parsed.complianceItems,
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      result = {
        action: task.action,
        summary: loopResult.content || '',
        risks: [
          {
            risk: 'Manual review required — LLM output was not structured JSON; risk findings are incomplete. Do not sign / file / publicize without counsel review.',
            severity: 'high' as const,
            clause: 'parse-failure',
            recommendation: 'Consult counsel before relying on any portion of this output.',
          },
        ],
        complianceItems: [
          {
            item: 'Manual review required — parse failure',
            status: 'missing' as const,
            regulation: 'unknown',
            action: 'Re-run the agent with a stricter prompt or escalate to legal.',
          },
        ],
        confidence: 0.3,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        riskCount: result.risks?.length ?? 0,
        complianceItemCount: result.complianceItems?.length ?? 0,
        confidence: result.confidence,
      },
      'Legal agent completed',
    );

    return result;
  }
}
