import type OpenAI from 'openai';
import { AgentRole, Industry, INDUSTRY_KEYWORDS } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';
import {
  CommanderResponseSchema,
  type CommanderResponseT,
} from '../runtime/schemas/index.js';

export interface MissionBrief {
  id: string;
  goal: string;
  intent: string;
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

const COMMANDER_SUPPLEMENT = `You are a Commander agent. Your role is to understand user intent precisely and either (a) answer trivial requests directly to avoid unnecessary orchestration, or (b) extract structured intelligence from raw user input so specialist agents can execute.

Respond with strict JSON only — no markdown fences, no prose prefix, no explanation.

You must respond with a JSON object matching this schema:
{
  "directAnswer": "<string or null>",
  "intent": "one sentence describing what the user wants to accomplish",
  "subFunction": "the specific business sub-function this relates to (e.g. 'Claims Processing', 'Invoice Approval', 'Customer Onboarding')",
  "urgency": <number 1-5 where 1=not urgent, 5=critical/emergency>,
  "riskIndicators": ["list of strings describing potential risks or sensitive aspects"],
  "requiredOutputs": ["list of expected deliverables or outputs"],
  "clarificationNeeded": <boolean>,
  "clarificationQuestion": "<question to ask the user if clarification is needed, or null>"
}

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

  async execute(input: unknown, context: AgentContext): Promise<CommanderOutput> {
    const startedAt = new Date();
    const rawInput = typeof input === 'string' ? input : JSON.stringify(input);

    this.logger.info({ runId: context.runId }, 'Commander processing input');

    const detectedIndustry = context.industry
      ? (context.industry as Industry)
      : detectIndustry(rawInput);

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(COMMANDER_SUPPLEMENT),
      },
      {
        role: 'user',
        content: `Industry context: ${detectedIndustry}\n\nUser input: ${rawInput}`,
      },
    ];

    // Phase 4: route via the LLMRuntime structured-output helper. Both
    // runtimes validate against the zod schema; OpenAIRuntime enforces
    // schema compliance at the model layer (no prose drift). On parse
    // failure we fall back to the same defaults the legacy path used.
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
      // shape — fall back to default mission brief, workflow continues) from
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
      this.logger.warn({ err: msg }, 'Commander structured response failed (recoverable schema/transient); using fallback mission brief');
      parsed = {
        directAnswer: null,
        intent: rawInput,
        subFunction: 'General Task',
        urgency: 3,
        riskIndicators: [],
        requiredOutputs: ['task completion'],
        clarificationNeeded: false,
        clarificationQuestion: null,
      };
    }

    // Token usage is no longer surfaced through respondStructured (Phase 6
    // will add a callbacks interface to the runtime for usage telemetry).
    // For Phase 4 we rely on the runtime's internal cost tracking
    // (BaseAgent.onLLMCallComplete still fires from LegacyRuntime; OpenAI
    // tracks cost in callTools but not respondStructured yet).
    const tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined = undefined;

    // Direct-answer short-circuit — trivial inputs terminate the workflow
    // here without running the Planner/Router/Workers/Verifier pipeline.
    const directAnswer = typeof parsed.directAnswer === 'string'
      ? parsed.directAnswer.trim()
      : '';
    if (directAnswer.length > 0) {
      const output: CommanderOutput = {
        clarificationNeeded: false,
        directAnswer,
      };
      const trace = this.recordTrace(context, input, output, [], startedAt);
      if (tokenUsage) trace.tokenUsage = tokenUsage;
      this.logger.info({ runId: context.runId, len: directAnswer.length }, 'Commander direct-answered');
      return output;
    }

    if (parsed.clarificationNeeded) {
      const output: CommanderOutput = {
        clarificationNeeded: true,
        clarificationQuestion: parsed.clarificationQuestion ?? undefined,
      };

      const trace = this.recordTrace(context, input, output, [], startedAt);
      if (tokenUsage) trace.tokenUsage = tokenUsage;

      return output;
    }

    const missionBrief: MissionBrief = {
      id: this.generateId('mb_'),
      goal: rawInput,
      intent: parsed.intent ?? rawInput,
      industry: detectedIndustry,
      subFunction: parsed.subFunction ?? 'General Task',
      urgency: (Math.min(5, Math.max(1, parsed.urgency ?? 3)) as 1 | 2 | 3 | 4 | 5),
      riskIndicators: parsed.riskIndicators ?? [],
      requiredOutputs: parsed.requiredOutputs ?? [],
      clarificationNeeded: false,
      rawInput,
      createdAt: new Date(),
    };

    const output: CommanderOutput = {
      missionBrief,
      clarificationNeeded: false,
    };

    const trace = this.recordTrace(context, input, output, [], startedAt);
    if (tokenUsage) trace.tokenUsage = tokenUsage;

    this.logger.info(
      { missionBriefId: missionBrief.id, industry: detectedIndustry },
      'Commander produced mission brief',
    );

    return output;
  }
}

