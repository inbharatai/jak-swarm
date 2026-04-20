import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
// ToolCall type used internally by executeWithTools()
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type CalendarAction =
  | 'LIST_EVENTS'
  | 'CREATE_EVENT'
  | 'FIND_AVAILABILITY'
  | 'UPDATE_EVENT'
  | 'DELETE_EVENT';

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  attendees?: string[];
  location?: string;
  description?: string;
  recurring?: boolean;
  timezone?: string;
}

export interface AvailabilitySlot {
  start: string;
  end: string;
  durationMinutes: number;
  conflictCount: number;
}

export interface CalendarTask {
  action: CalendarAction;
  eventId?: string;
  dateRange?: { from: string; to: string };
  eventDetails?: {
    title: string;
    start: string;
    end: string;
    attendees?: string[];
    location?: string;
    description?: string;
    timezone?: string;
  };
  attendees?: string[];
  durationMinutes?: number;
  timezone?: string;
}

/** Meeting type classification — drives default duration + buffer recommendations. */
export type MeetingType =
  | 'oneonone'
  | 'interview'
  | 'team_standup'
  | 'deep_work'
  | 'external'
  | 'all_hands'
  | 'status_review'
  | 'unknown';

export interface SchedulingConflict {
  attendee: string;
  conflictWith: string; // title of the overlapping event
  start: string;
  end: string;
  /** Severity: hard = cannot schedule without moving; soft = back-to-back / buffer violation. */
  severity: 'hard' | 'soft';
}

/** Why this slot was picked — expert scheduling reasoning. */
export interface SlotRationale {
  slot: AvailabilitySlot;
  reasons: string[];
  /** 0-100: how well the slot matches expert defaults (TZ, focus time, buffer, type fit). */
  quality: number;
}

export interface CalendarResult {
  action: CalendarAction;
  events?: CalendarEvent[];
  createdEvent?: CalendarEvent;
  availability?: AvailabilitySlot[];
  /** Best slot among `availability` plus analyst reasoning. */
  recommendedSlot?: SlotRationale;
  /** Conflicts detected during the analysis — hard + soft. */
  conflicts?: SchedulingConflict[];
  /** Meeting-type classification that drove duration + buffer defaults. */
  meetingType?: MeetingType;
  /** Buffer minutes applied around the recommended slot. */
  appliedBufferMinutes?: number;
  requiresApproval: boolean;
  approvalReason?: string;
}

const CALENDAR_SUPPLEMENT = `You are an expert executive assistant. You don't just list open slots — you classify the meeting type, apply the right duration and buffer defaults, detect hard vs soft conflicts, and recommend ONE slot with an explicit rationale.

Action handling:
- LIST_EVENTS: chronological events in the range. Include TZ for every event.
- CREATE_EVENT / UPDATE_EVENT / DELETE_EVENT: always requiresApproval=true with proposed details — never claim to have mutated the calendar.
- FIND_AVAILABILITY: return candidate slots AND a recommendedSlot with reasoning. Classify meetingType FIRST.

Meeting-type classification → default duration + buffer:
- oneonone:       25 or 50 min; 5 min buffer before + after.
- interview:      45 min; 10 min buffer; avoid first/last hour of day.
- team_standup:   15 min; 0 buffer; same time daily.
- deep_work:      90-120 min; protect morning in the owner's TZ.
- external:       30 min default; 10 min buffer; keep within business hours of the EXTERNAL party's TZ.
- all_hands:      30-60 min; cross-TZ fairness check (rotate unfriendly hours).
- status_review:  30 min; 5 min buffer.

Timezone rules (hard requirements):
1. Every slot start/end MUST carry a timezone. ISO 8601 with offset or explicit timezone field.
2. Convert attendee-friendly business hours to their LOCAL TZ. 9-11am Tue/Wed/Thu in the attendee's TZ > anywhere else. Never schedule 10pm-5am local.
3. For cross-TZ meetings, surface the worst-case attendee (who got the early/late slot) in rationale.reasons.
4. DST-aware: when the date window crosses a DST boundary, flag it in rationale.reasons.

Conflict detection:
- hard: overlap with an existing event for the same attendee — cannot schedule.
- soft: zero buffer (back-to-back) OR violates focus-time policy (e.g. Friday afternoon "no meeting" zone) — can schedule but flag.
- Report ALL conflicts in conflicts[]. Don't hide soft ones.

Recommended slot scoring (0-100 quality):
- +30 if every attendee is in business hours (9-5 local).
- +20 if no soft conflicts.
- +15 if meeting type matches standard duration.
- +15 if it's a preferred day (Tue/Wed/Thu > Mon/Fri) and not at the edge of the day.
- +10 if buffers applied on both sides.
- +10 if it's the EARLIEST viable slot across attendees.
- Subtract 40 for any attendee outside 8-8 local. Subtract 30 for hard conflicts (should never be in candidates).

Return STRICT JSON matching CalendarResult. Populate recommendedSlot.reasons with 2-4 specific, factual statements. No pleasantries.`;

/** Actions that mutate calendar state and must be reviewed by a human. */
const APPROVAL_REQUIRED_ACTIONS: Set<CalendarAction> = new Set([
  'CREATE_EVENT',
  'UPDATE_EVENT',
  'DELETE_EVENT',
]);

export class CalendarAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_CALENDAR, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<CalendarResult> {
    const startedAt = new Date();
    const task = input as CalendarTask;

    this.logger.info(
      { runId: context.runId, action: task.action },
      'Calendar agent executing task',
    );

    // Mutating actions require human approval — short-circuit with the details
    if (APPROVAL_REQUIRED_ACTIONS.has(task.action)) {
      const result: CalendarResult = {
        action: task.action,
        requiresApproval: true,
        approvalReason: `Calendar ${task.action.toLowerCase().replace('_', ' ')} operations require explicit human approval before execution.`,
        createdEvent:
          task.action === 'CREATE_EVENT' && task.eventDetails
            ? {
                id: this.generateId('evt_'),
                title: task.eventDetails.title,
                start: task.eventDetails.start,
                end: task.eventDetails.end,
                attendees: task.eventDetails.attendees,
                location: task.eventDetails.location,
                description: task.eventDetails.description,
                timezone: task.eventDetails.timezone ?? task.timezone,
              }
            : undefined,
      };
      this.recordTrace(context, input, result, [], startedAt);
      return result;
    }

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'list_calendar_events',
          description: 'List calendar events within a date range',
          parameters: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'Start date in ISO 8601 format' },
              to: { type: 'string', description: 'End date in ISO 8601 format' },
              timezone: { type: 'string', description: 'IANA timezone name' },
            },
            required: ['from', 'to'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'create_calendar_event',
          description: 'Create a new calendar event (requires approval)',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              start: { type: 'string' },
              end: { type: 'string' },
              attendees: { type: 'array', items: { type: 'string' } },
              location: { type: 'string' },
              description: { type: 'string' },
              timezone: { type: 'string' },
            },
            required: ['title', 'start', 'end'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'find_availability',
          description: 'Find available time slots for a set of attendees',
          parameters: {
            type: 'object',
            properties: {
              attendees: { type: 'array', items: { type: 'string' } },
              from: { type: 'string' },
              to: { type: 'string' },
              durationMinutes: { type: 'number' },
              timezone: { type: 'string' },
            },
            required: ['attendees', 'from', 'to', 'durationMinutes'],
          },
        },
      },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(CALENDAR_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          dateRange: task.dateRange,
          eventDetails: task.eventDetails,
          attendees: task.attendees,
          durationMinutes: task.durationMinutes,
          timezone: task.timezone,
          industryContext: context.industry,
        }),
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 1536,
        temperature: 0.2,
        maxIterations: 3,
      });
    } catch (err) {
      this.logger.error({ err }, 'Calendar executeWithTools failed');
      const fallback: CalendarResult = {
        action: task.action,
        requiresApproval: false,
        events: [],
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: CalendarResult;

    try {
      const parsed = this.parseJsonResponse<Partial<CalendarResult>>(loopResult.content);
      result = {
        action: task.action,
        events: parsed.events,
        createdEvent: parsed.createdEvent,
        availability: parsed.availability,
        recommendedSlot: parsed.recommendedSlot,
        conflicts: parsed.conflicts,
        meetingType: parsed.meetingType,
        appliedBufferMinutes: parsed.appliedBufferMinutes,
        requiresApproval: false,
      };
    } catch {
      // LLM returned freeform text — do not auto-book anything without review
      result = {
        action: task.action,
        events: [],
        conflicts: [
          {
            attendee: '(all)',
            conflictWith: 'Manual review required — LLM output was not structured JSON. Scheduling decisions are incomplete. Do NOT create, modify, or delete calendar events without a human review.',
            start: new Date().toISOString(),
            end: new Date().toISOString(),
            severity: 'hard' as const,
          },
        ],
        requiresApproval: true,
        approvalReason: 'Parse failure in calendar agent. Verify before sending invites.',
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        eventCount: result.events?.length ?? 0,
        slotCount: result.availability?.length ?? 0,
      },
      'Calendar agent completed',
    );

    return result;
  }
}
