import type OpenAI from 'openai';
import { AgentRole, Industry, INDUSTRY_KEYWORDS } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';
import {
  CommanderResponseSchema,
  type CommanderResponseT,
} from '../runtime/schemas/index.js';
import {
  COMPANY_OS_INTENTS,
  INTENT_DESCRIPTIONS,
  type CompanyOSIntent,
} from '../intents/intent-vocabulary.js';

export interface MissionBrief {
  id: string;
  goal: string;
  /**
   * One of the 18 named intents (CompanyOSIntent enum). Constrained at
   * the LLM layer via CommanderResponseSchema. Falls back to
   * 'ambiguous_request' when the LLM is uncertain or to 'general_question'
   * when Commander short-circuits with a directAnswer.
   */
  intent: CompanyOSIntent;
  intentConfidence: number | null;
  industry: Industry;
  subFunction: string;
  urgency: 1 | 2 | 3 | 4 | 5;
  riskIndicators: string[];
  requiredOutputs: string[];
  clarificationNeeded: boolean;
  clarificationQuestion?: string;
  rawInput: string;
  createdAt: Date;
}

export interface CommanderOutput {
  missionBrief?: MissionBrief;
  clarificationNeeded: boolean;
  clarificationQuestion?: string;
  /**
   * If set, the Commander answered the user's input directly without
   * needing the full multi-agent pipeline. The workflow terminates
   * immediately and this string becomes workflow.finalOutput.
   * Used for greetings, trivial factual questions, small-talk, etc.
   */
  directAnswer?: string;
}

function detectIndustry(text: string): Industry {
  const lower = text.toLowerCase();
  let bestMatch: Industry = Industry.GENERAL;
  let bestScore = 0;

  for (const [industry, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    const score = keywords.filter((kw) => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = industry as Industry;
    }
  }

  return bestMatch;
}

const COMMANDER_INTENT_CATALOG = COMPANY_OS_INTENTS
  .map((i) => `  - "${i}": ${INTENT_DESCRIPTIONS[i]}`)
  .join('\n');

/**
 * Deterministic intent inference from raw user text.
 * Runs BEFORE the LLM and AGAIN after LLM failure/ambiguity.
 * This prevents simple business prompts from falling into the
 * generic "I had trouble understanding your request" fallback.
 */
export function inferIntentFromKeywords(rawInput: string): {
  intent: CompanyOSIntent;
  confidence: number;
  subFunction: string;
} | null {
  const lower = rawInput.toLowerCase();

  // URL review patterns (CTO / browser) — hardened to catch bare domains like
  // "check jakswarm.com" without requiring http:// or www. prefixes.
  const URL_REVIEW_WORDS = /\b(review|audit|check|inspect|analyse|analyze)\b/;
  const URL_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-z0-9-]+\.(com|io|co|ai|net|org|dev|app|xyz|info)(\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=-]*)?)/i;
  if (URL_REVIEW_WORDS.test(lower) && URL_PATTERN.test(rawInput)) {
    return { intent: 'website_review_and_improvement', confidence: 0.92, subFunction: 'Website Review' };
  }
  if (URL_PATTERN.test(rawInput) && URL_REVIEW_WORDS.test(lower)) {
    return { intent: 'website_review_and_improvement', confidence: 0.92, subFunction: 'Website Review' };
  }

  // Legacy regex fallbacks (kept for backwards compatibility)
  if (/\b(review|audit|check|inspect|analyse|analyze)\b.*\b(http|www\.|\.com|\.io|\.co|\.ai|\.net|\.org|\.dev)\b/i.test(lower)) {
    return { intent: 'website_review_and_improvement', confidence: 0.92, subFunction: 'Website Review' };
  }
  if (/\b(http|www\.|\.com|\.io|\.co|\.ai|\.net|\.org|\.dev)\b.*\b(review|audit|check|inspect|analyse|analyze)\b/i.test(lower)) {
    return { intent: 'website_review_and_improvement', confidence: 0.92, subFunction: 'Website Review' };
  }

  // Marketing / campaign
  if (/\b(marketing plan|campaign plan|go-to-market|gtm|brand audit|social strategy|content calendar|marketing calendar)\b/i.test(lower)) {
    return { intent: 'marketing_campaign_generation', confidence: 0.9, subFunction: 'Marketing Campaign' };
  }

  // Content creation
  if (/\b(write|draft|create|generate|compose)\b.*\b(linkedin post|blog post|tweet|newsletter|press release|ad copy|landing copy|email copy|caption|thread)\b/i.test(lower)) {
    return { intent: 'marketing_campaign_generation', confidence: 0.88, subFunction: 'Content Creation' };
  }

  // Strategy / CEO
  if (/\b(swot|okrs?|strategy|vision|roadmap|executive summary|board deck|market entry|positioning analysis|competitive positioning)\b/i.test(lower)) {
    return { intent: 'company_strategy_review', confidence: 0.9, subFunction: 'Strategic Planning' };
  }

  // Investor materials
  if (/\b(investor|pitch deck|one pager|fundraising|series [a-z]|valuation|term sheet)\b/i.test(lower)) {
    return { intent: 'investor_material_generation', confidence: 0.9, subFunction: 'Investor Materials' };
  }

  // Competitor research
  if (/\b(competitors?|competitive|benchmark|compare companies|market research|industry analysis)\b/i.test(lower)) {
    return { intent: 'competitor_research', confidence: 0.88, subFunction: 'Competitive Research' };
  }

  // Code / technical
  if (/\b(write|generate|build|fix|debug|refactor|review)\b.*\b(code|script|function|api|test|class|module|component|app|repository|repo)\b/i.test(lower)) {
    return { intent: 'codebase_review_and_patch', confidence: 0.88, subFunction: 'Code Task' };
  }

  // Research
  if (/\b(research|find|compare|investigate|benchmark)\b.*\b(topic|market|competitor|vendor|trends|data)\b/i.test(lower)) {
    return { intent: 'research_and_report', confidence: 0.85, subFunction: 'Research' };
  }

  // Pricing
  if (/\b(pricing|unit economics|cac|ltv|gross margin|burn rate|cashflow)\b/i.test(lower)) {
    return { intent: 'pricing_and_unit_economics_review', confidence: 0.88, subFunction: 'Pricing Review' };
  }

  // Sales outreach
  if (/\b(sales outreach|cold email|prospect|lead gen|outreach sequence|follow-up email)\b/i.test(lower)) {
    return { intent: 'sales_outreach_draft_generation', confidence: 0.88, subFunction: 'Sales Outreach' };
  }

  // Operations / SOP
  if (/\b(sop|standard operating procedure|operations manual|runbook|process doc|workflow doc)\b/i.test(lower)) {
    return { intent: 'operations_sop_generation', confidence: 0.88, subFunction: 'Operations' };
  }

  // Customer persona
  if (/\b(customer persona|user persona|buyer persona|target audience|ideal customer|icp)\b/i.test(lower)) {
    return { intent: 'customer_persona_generation', confidence: 0.88, subFunction: 'Customer Persona' };
  }

  // Product positioning
  if (/\b(product positioning|messaging hierarchy|value prop|value proposition|product copy)\b/i.test(lower)) {
    return { intent: 'product_positioning_review', confidence: 0.88, subFunction: 'Product Positioning' };
  }

  // Legal / compliance
  if (/\b(contract|nda|privacy policy|terms of service|compliance|regulation|gdpr|soc 2|iso 27001)\b/i.test(lower)) {
    return { intent: 'audit_compliance_workflow', confidence: 0.85, subFunction: 'Legal / Compliance' };
  }

  // HR / hiring
  if (/\b(hire|hiring|job description|jd|onboard|offer letter|resume|performance review|hr policy)\b/i.test(lower)) {
    return { intent: 'operations_sop_generation', confidence: 0.82, subFunction: 'HR / People Ops' };
  }

  // Document analysis
  if (/\b(summarise|summarize|extract|compare|analyze|analyse)\b.*\b(document|file|pdf|upload)\b/i.test(lower)) {
    return { intent: 'document_analysis', confidence: 0.85, subFunction: 'Document Analysis' };
  }

  // Browser inspection (generic URL without "review")
  if (/\b(visit|scrape|extract|screenshot)\b.*\b(http|www\.|\.com|\.io|\.co|\.ai)\b/i.test(lower)) {
    return { intent: 'browser_inspection', confidence: 0.85, subFunction: 'Browser Inspection' };
  }

  return null;
}

/** Normalize bare URLs (www.x.com → https://www.x.com). */
function normalizeUrls(text: string): string {
  return text.replace(/\b(www\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,})(\/[^\s]*)?\b/g, 'https://$1$2');
}

/**
 * Fast clarification route for dashboard/card copy pasted as input.
 *
 * Example input pattern:
 * "Billing Manage your subscription and payment method. Current Plan ..."
 *
 * These snippets are usually UI text without an explicit user action and can
 * be answered immediately without paying LLM latency.
 */
export function inferFastClarificationFromUiCard(rawInput: string): string | null {
  const compact = rawInput.replace(/\s+/g, ' ').trim();
  if (!compact) return null;

  const lower = compact.toLowerCase();
  const billingSignals = [
    /\bbilling\b/,
    /\bsubscription\b/,
    /\bpayment method\b/,
    /\bcurrent plan\b/,
    /\bincluded usage\b/,
  ];
  const signalHits = billingSignals.reduce((count, pattern) =>
    count + (pattern.test(lower) ? 1 : 0), 0,
  );

  // Require multiple billing-specific markers to avoid false positives.
  if (signalHits < 3) return null;

  const looksLikeCardCopy = /manage your subscription/i.test(lower) || /current plan/i.test(lower);
  if (!looksLikeCardCopy) return null;

  const hasExplicitAction = /\b(summar(?:ize|ise)|review|draft|write|create|generate|analy(?:ze|se)|compare|fix|troubleshoot|debug|explain|optimi(?:ze|se)|help|recommend)\b/i.test(lower);
  if (hasExplicitAction) return null;

  return 'What should I do with this billing/subscription info: summarize it, review pricing/plan messaging, draft customer-facing copy, or troubleshoot a payment issue?';
}

const COMMANDER_SUPPLEMENT = `You are a Commander agent. Your role is to understand user intent precisely and either (a) answer trivial requests directly to avoid unnecessary orchestration, or (b) extract structured intelligence from raw user input so specialist agents can execute.

Respond with strict JSON only — no markdown fences, no prose prefix, no explanation.

You must respond with a JSON object matching this schema:
{
  "directAnswer": "<string or null>",
  "intent": "<one of the 18 named intents below>",
  "intentConfidence": <number 0-1 — your confidence in the intent classification>,
  "subFunction": "the specific business sub-function this relates to (e.g. 'Claims Processing', 'Invoice Approval', 'Customer Onboarding')",
  "urgency": <number 1-5 where 1=not urgent, 5=critical/emergency>,
  "riskIndicators": ["list of strings describing potential risks or sensitive aspects"],
  "requiredOutputs": ["list of expected deliverables or outputs"],
  "clarificationNeeded": <boolean>,
  "clarificationQuestion": "<question to ask the user if clarification is needed, or null>"
}

NAMED INTENT VOCABULARY (intent MUST be exactly one of these values):
${COMMANDER_INTENT_CATALOG}

How to choose:
- Pick the SINGLE best-matching intent from the list above. Set intentConfidence to your honest confidence (0.9+ when obvious, 0.6-0.8 for plausible match, <0.6 when unsure).
- When intentConfidence < 0.6 AND no intent is a strong fit → use "ambiguous_request" + set clarificationNeeded=true + write a clarificationQuestion.
- When directAnswer is set (greeting/trivial) → use "general_question".
- When the user request is "audit my compliance" / "run a SOC 2 audit" → use "audit_compliance_workflow" (this routes to the dedicated /audit/runs API surface).

ABSOLUTE RULE — Forbidden fallback phrase:
NEVER return "I had trouble understanding your request. Could you rephrase what you'd like me to do?" or any variation of it (e.g., "I had trouble understanding", "Could you rephrase", "I'm not sure what you mean"). These phrases are FORBIDDEN. If the input is not a trivial greeting or obvious fact, you MUST return a missionBrief (structured plan) or set clarificationNeeded=true with a SPECIFIC question — never a generic "rephrase" request.

ABSOLUTE RULE — Website / URL requests are NEVER ambiguous:
Any request that mentions a website, URL, or domain name (e.g., "check mysite.com", "review www.example.com", "audit the website", "visit jakswarm.com") MUST ALWAYS produce a missionBrief with intent "website_review_and_improvement" or "browser_inspection". NEVER directAnswer these. NEVER ask the user to rephrase. NEVER return clarificationNeeded for these. Proceed immediately.

CRITICAL RULE — Direct-answer short-circuit:
Set \`directAnswer\` to a non-empty string ONLY when the input can be answered from general knowledge WITHOUT needing to search the web, run tools, write code, fetch user documents, or consult other agents.

Examples that MUST get a directAnswer:
- Greetings: "hi", "hello", "how are you" → "Hello! I'm JAK Swarm. What would you like me to help you build, operate, or verify?"
- Simple arithmetic: "what is 2+2?" → "4"
- Capital cities, definitions, obvious facts: "capital of France" → "Paris"
- Meta-questions about JAK: "what can you do?" → a 2-sentence summary
- Thanks/acknowledgements: "thanks", "ok" → "You're welcome — let me know what to tackle next."

Examples that MUST NOT get a directAnswer (use the structured plan path instead):
- Anything requiring current information (prices, news, rates, recent events)
- Document analysis ("review my NDA", "summarize this brief")
- Code generation or app building
- Multi-step workflows ("plan a launch", "audit competitors")
- Tasks referencing external systems (Slack, GitHub, Gmail, CRM)
- Anything ambiguous where clarification might help
- Website / URL review or audit requests ("check mysite.com", "review www.example.com")

When directAnswer is set, you may leave intent/subFunction/urgency/etc at minimal sensible defaults — the workflow will terminate after you and the other fields are ignored.

Guidelines for the non-shortcut path:
- Bias STRONGLY toward proceeding without clarification. The specialist agents downstream are smart enough to fill gaps with reasonable defaults and flag assumptions in their output. A user who asked "do a SWOT for our early-stage AI platform" has given enough to START — do not hold them up with a questionnaire. Only set clarificationNeeded=true when ONE of these is true:
  (a) the request could cause an external side-effect (send, post, publish, charge, delete) and a critical parameter is missing (e.g. recipient, amount, destination).
  (b) the request names a file/doc/project/person that you have zero way to identify without more info.
  (c) the request is one or two words with no context AND isn't a trivial greeting/factual Q you can direct-answer.
  In all other cases, proceed and let the specialists work from the user's prompt as given.
- urgency=5 is reserved for patient emergencies, financial crises, or compliance deadlines within hours.
- riskIndicators should flag PII handling, external communications, data deletion, financial transactions, etc.
- requiredOutputs should be concrete: 'summarized email draft', 'updated CRM record', 'classification label', etc.
- NEVER make up information. Extract only what the user actually said.`;

export class CommanderAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.COMMANDER, apiKey);
  }

  async _executeImpl(input: unknown, context: AgentContext): Promise<CommanderOutput> {
    const startedAt = new Date();
    const rawInput = typeof input === 'string' ? input : JSON.stringify(input);

    // Normalize URLs so the LLM sees full https:// URLs
    const normalizedInput = normalizeUrls(rawInput);

    // Fast path: when the user pasted billing card copy with no explicit ask,
    // avoid a slow LLM round-trip and return a deterministic clarification.
    const fastClarification = inferFastClarificationFromUiCard(normalizedInput);
    if (fastClarification) {
      const output: CommanderOutput = {
        clarificationNeeded: true,
        clarificationQuestion: fastClarification,
      };
      this.recordTrace(context, input, output, [], startedAt);
      this.logger.info(
        { runId: context.runId, source: 'ui_card_fast_clarification' },
        'Commander returned deterministic clarification for dashboard card copy',
      );
      return output;
    }

    this.logger.info({ runId: context.runId, inputPreview: normalizedInput.slice(0, 120) }, 'Commander processing input');

    const detectedIndustry = context.industry
      ? (context.industry as Industry)
      : detectIndustry(normalizedInput);

    // Phase 4-pre: deterministic keyword inference BEFORE calling the LLM.
    // Obvious inputs (website review, marketing plan, legal contract, etc.)
    // are routed immediately without wasting tokens on an LLM call that may
    // hallucinate a generic fallback. Confidence threshold is intentionally
    // high (>= 0.85) so we only skip the LLM when the signal is unambiguous.
    const preInferred = inferIntentFromKeywords(normalizedInput);
    if (preInferred && preInferred.confidence >= 0.85) {
      this.logger.info(
        { runId: context.runId, intent: preInferred.intent, confidence: preInferred.confidence, source: 'pre_llm_keyword' },
        'Commander routed via pre-LLM keyword inference — skipping LLM call',
      );
      const missionBrief: MissionBrief = {
        id: this.generateId('mb_'),
        goal: normalizedInput,
        intent: preInferred.intent as CompanyOSIntent,
        intentConfidence: preInferred.confidence,
        industry: detectedIndustry,
        subFunction: preInferred.subFunction,
        urgency: 3,
        riskIndicators: [],
        requiredOutputs: ['task completion'],
        clarificationNeeded: false,
        rawInput: normalizedInput,
        createdAt: new Date(),
      };
      const output: CommanderOutput = { missionBrief, clarificationNeeded: false };
      this.recordTrace(context, input, output, [], startedAt);
      return output;
    }

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(COMMANDER_SUPPLEMENT),
      },
      {
        role: 'user',
        content: `Industry context: ${detectedIndustry}\n\nUser input: ${normalizedInput}`,
      },
    ];

    // Phase 4: route via the LLMRuntime structured-output helper. Both
    // runtimes validate against the zod schema; OpenAIRuntime enforces
    // schema compliance at the model layer (no prose drift). On parse
    // failure we fall back to deterministic keyword inference instead of
    // the generic ambiguous_request.
    let parsed: CommanderResponseT;
    try {
      parsed = await this.runtime.respondStructured(
        messages,
        CommanderResponseSchema,
        {
          maxTokens: 1024,
          temperature: 0.1,
          schemaName: 'CommanderResponse',
          schemaDescription: 'Structured intent decomposition for the JAK Swarm Commander agent',
        },
        context,
      );
    } catch (err) {
      // Distinguish recoverable schema mismatches (LLM responded with bad
      // shape — fall back to keyword inference, workflow continues) from
      // fatal configuration errors (auth, model-not-found, network down —
      // re-throw so the workflow fails honestly instead of silently
      // continuing with a default brief).
      const msg = err instanceof Error ? err.message : String(err);
      const isFatalConfig =
        /\b401\b|\b403\b|incorrect api key|invalid api key|model_not_found|model not found|model[- ]?that[- ]?does[- ]?not[- ]?exist|insufficient_quota|api key/i.test(msg);
      if (isFatalConfig) {
        this.logger.error({ err: msg }, 'Commander structured response hit a fatal configuration error; failing the workflow');
        throw err;
      }
      this.logger.warn({ err: msg }, 'Commander structured response failed (recoverable schema/transient); using deterministic keyword inference');

      // Try deterministic inference before giving up
      const inferred = inferIntentFromKeywords(normalizedInput);
      if (inferred) {
        this.logger.info({ runId: context.runId, intent: inferred.intent, source: 'keyword_fallback' }, 'Commander inferred intent from keywords after LLM failure');
        parsed = {
          directAnswer: null,
          intent: inferred.intent,
          intentConfidence: inferred.confidence,
          subFunction: inferred.subFunction,
          urgency: 3,
          riskIndicators: [],
          requiredOutputs: ['task completion'],
          clarificationNeeded: false,
          clarificationQuestion: null,
        };
      } else {
        parsed = {
          directAnswer: null,
          intent: 'ambiguous_request',
          intentConfidence: 0,
          subFunction: 'General Task',
          urgency: 3,
          riskIndicators: [],
          requiredOutputs: ['task completion'],
          clarificationNeeded: true,
          clarificationQuestion: buildHelpfulClarification(normalizedInput, detectedIndustry),
        };
      }
    }

    const usageSummary = context.getLLMUsageSummary();
    const tokenUsage = usageSummary
      ? {
          promptTokens: usageSummary.promptTokens,
          completionTokens: usageSummary.completionTokens,
          totalTokens: usageSummary.totalTokens,
        }
      : undefined;

    // Direct-answer short-circuit — trivial inputs terminate the workflow
    // here without running the Planner/Router/Workers/Verifier pipeline.
    const directAnswer = typeof parsed.directAnswer === 'string'
      ? parsed.directAnswer.trim()
      : '';
    if (directAnswer.length > 0) {
      // Guard: intercept any directAnswer that smells like the old generic
      // fallback phrase. If keyword inference would have matched, produce a
      // missionBrief instead so the workflow continues to the specialist
      // agents rather than terminating with an unhelpful message.
      if (/had trouble understanding|could you rephrase|i.m not sure what you mean/i.test(directAnswer)) {
        const inferred = inferIntentFromKeywords(normalizedInput);
        if (inferred) {
          this.logger.warn(
            { runId: context.runId, directAnswer: directAnswer.slice(0, 80), intent: inferred.intent, source: 'directAnswer_guard' },
            'Commander blocked generic fallback directAnswer; routing via keyword inference instead',
          );
          const missionBrief: MissionBrief = {
            id: this.generateId('mb_'),
            goal: normalizedInput,
            intent: inferred.intent as CompanyOSIntent,
            intentConfidence: inferred.confidence,
            industry: detectedIndustry,
            subFunction: inferred.subFunction,
            urgency: 3,
            riskIndicators: [],
            requiredOutputs: ['task completion'],
            clarificationNeeded: false,
            rawInput: normalizedInput,
            createdAt: new Date(),
          };
          const output: CommanderOutput = { missionBrief, clarificationNeeded: false };
          const trace = this.recordTrace(context, input, output, [], startedAt);
          if (tokenUsage) trace.tokenUsage = tokenUsage;
          if (usageSummary) trace.costUsd = usageSummary.costUsd;
          return output;
        }
      }

      const output: CommanderOutput = {
        clarificationNeeded: false,
        directAnswer,
      };
      const trace = this.recordTrace(context, input, output, [], startedAt);
      if (tokenUsage) trace.tokenUsage = tokenUsage;
      if (usageSummary) trace.costUsd = usageSummary.costUsd;
      this.logger.info({ runId: context.runId, len: directAnswer.length }, 'Commander direct-answered');
      return output;
    }

    // If the LLM asked for clarification, try deterministic inference
    // one more time before accepting it. Many "ambiguous" prompts have
    // enough signal in the raw text to route correctly.
    if (parsed.clarificationNeeded) {
      const inferred = inferIntentFromKeywords(normalizedInput);
      if (inferred && inferred.confidence >= 0.75) {
        this.logger.info({ runId: context.runId, intent: inferred.intent, source: 'keyword_override' }, 'Commander overrode LLM clarification with keyword inference');
        parsed.intent = inferred.intent;
        parsed.intentConfidence = inferred.confidence;
        parsed.subFunction = inferred.subFunction;
        parsed.clarificationNeeded = false;
        parsed.clarificationQuestion = null;
      } else {
        const output: CommanderOutput = {
          clarificationNeeded: true,
          clarificationQuestion: parsed.clarificationQuestion ?? buildHelpfulClarification(normalizedInput, detectedIndustry),
        };

        const trace = this.recordTrace(context, input, output, [], startedAt);
        if (tokenUsage) trace.tokenUsage = tokenUsage;
        if (usageSummary) trace.costUsd = usageSummary.costUsd;

        return output;
      }
    }

    const missionBrief: MissionBrief = {
      id: this.generateId('mb_'),
      goal: normalizedInput,
      // parsed.intent is now constrained to a CompanyOSIntent by the schema;
      // null only when the LLM omits it (rare given strict json_schema). We
      // fall back to 'ambiguous_request' rather than free text to keep the
      // downstream IntentRecord + WorkflowTemplate lookup surface stable.
      intent: (parsed.intent as CompanyOSIntent | null) ?? 'ambiguous_request',
      intentConfidence: parsed.intentConfidence,
      industry: detectedIndustry,
      subFunction: parsed.subFunction ?? 'General Task',
      urgency: (Math.min(5, Math.max(1, parsed.urgency ?? 3)) as 1 | 2 | 3 | 4 | 5),
      riskIndicators: parsed.riskIndicators ?? [],
      requiredOutputs: parsed.requiredOutputs ?? [],
      clarificationNeeded: false,
      rawInput: normalizedInput,
      createdAt: new Date(),
    };

    const output: CommanderOutput = {
      missionBrief,
      clarificationNeeded: false,
    };

    const trace = this.recordTrace(context, input, output, [], startedAt);
    if (tokenUsage) trace.tokenUsage = tokenUsage;
    if (usageSummary) trace.costUsd = usageSummary.costUsd;

    this.logger.info(
      { missionBriefId: missionBrief.id, industry: detectedIndustry },
      'Commander produced mission brief',
    );

    return output;
  }
}

/** Build a helpful, role-aware clarification question instead of the generic
 *  "I had trouble understanding your request. Could you rephrase?" fallback.
 */
export function buildHelpfulClarification(rawInput: string, _industry?: string): string {
  const lower = rawInput.toLowerCase();

  // If the user mentioned a role, ask specifically about what deliverable
  const roleMatch = lower.match(/\b(cto|cmo|ceo|code|research|design|auto|legal|hr|ops|product|sales|support|finance|security|compliance)\b/);
  if (roleMatch && roleMatch[1]) {
    const role = roleMatch[1].toUpperCase();
    return `I can run this as a ${role} workflow, but I need one more detail to start: what deliverable would you like? (e.g., a report, a draft, a plan, or an audit)`;
  }

  // If the user mentioned a URL but no action
  if (/https?:\/\/|www\./.test(rawInput) && !/\b(review|audit|check|inspect|analyse|analyze|visit|scrape)\b/.test(lower)) {
    return `I see a URL in your message. Would you like me to review the website, extract data from it, or compare it to a competitor?`;
  }

  // If the input is very short
  if (rawInput.trim().split(/\s+/).length <= 3) {
    return `I can help with that. To route the right agent, could you tell me what you'd like produced — a report, a draft, a plan, or an analysis?`;
  }

  // Generic but helpful fallback
  return `I can run this, but I want to make sure I use the right specialist. Could you tell me the main goal — for example: review something, write a draft, create a plan, or research a topic?`;
}
