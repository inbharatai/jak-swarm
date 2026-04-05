import type OpenAI from 'openai';
import { AgentRole, Industry, INDUSTRY_KEYWORDS } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

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

const COMMANDER_SUPPLEMENT = `You are a Commander agent. Your role is to understand user intent precisely and extract structured intelligence from raw user input (text or voice transcript).

You must respond with a JSON object matching this schema:
{
  "intent": "one sentence describing what the user wants to accomplish",
  "subFunction": "the specific business sub-function this relates to (e.g. 'Claims Processing', 'Invoice Approval', 'Customer Onboarding')",
  "urgency": <number 1-5 where 1=not urgent, 5=critical/emergency>,
  "riskIndicators": ["list of strings describing potential risks or sensitive aspects"],
  "requiredOutputs": ["list of expected deliverables or outputs"],
  "clarificationNeeded": <boolean>,
  "clarificationQuestion": "<question to ask the user if clarification is needed, or null>"
}

Guidelines:
- Set clarificationNeeded=true only if the request is genuinely ambiguous and you cannot proceed safely without more info.
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

    const completion = await this.callLLM(messages, undefined, {
      maxTokens: 1024,
      temperature: 0.1,
    });

    const rawContent = completion.choices[0]?.message?.content ?? '{}';

    interface LLMCommanderResponse {
      intent?: string;
      subFunction?: string;
      urgency?: number;
      riskIndicators?: string[];
      requiredOutputs?: string[];
      clarificationNeeded?: boolean;
      clarificationQuestion?: string;
    }

    let parsed: LLMCommanderResponse;
    try {
      parsed = this.parseJsonResponse<LLMCommanderResponse>(rawContent);
    } catch (err) {
      this.logger.error({ err, rawContent }, 'Failed to parse Commander LLM response');
      parsed = {
        intent: rawInput,
        subFunction: 'General Task',
        urgency: 3,
        riskIndicators: [],
        requiredOutputs: ['task completion'],
        clarificationNeeded: false,
      };
    }

    const tokenUsage = completion.usage
      ? {
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        }
      : undefined;

    if (parsed.clarificationNeeded) {
      const output: CommanderOutput = {
        clarificationNeeded: true,
        clarificationQuestion: parsed.clarificationQuestion,
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

