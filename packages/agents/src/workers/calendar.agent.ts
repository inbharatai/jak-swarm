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

export interface CalendarResult {
  action: CalendarAction;
  events?: CalendarEvent[];
  createdEvent?: CalendarEvent;
  availability?: AvailabilitySlot[];
  requiresApproval: boolean;
  approvalReason?: string;
}

const CALENDAR_SUPPLEMENT = `You are a calendar worker agent. You manage scheduling tasks with precision and timezone awareness.

For LIST_EVENTS: retrieve events within a date range, ordered chronologically.
For CREATE_EVENT: compose a complete event with all required details. This ALWAYS requires approval.
For FIND_AVAILABILITY: identify open time slots across attendee calendars.
For UPDATE_EVENT: modify an existing event by ID. This ALWAYS requires approval.
For DELETE_EVENT: remove an event by ID. This ALWAYS requires approval.

Scheduling best practices:
- Always respect timezone differences and include timezone in outputs
- Detect scheduling conflicts before proposing times
- Avoid back-to-back meetings — suggest 5-10 minute buffers
- Prefer business hours (9 AM - 5 PM) in the attendee's local timezone unless specified otherwise
- For multi-attendee meetings, find the earliest slot that works for everyone
- Flag meetings outside business hours or on weekends

You have access to these tools:
- list_calendar_events: lists events in a date range
- create_calendar_event: creates a new calendar event (REQUIRES APPROVAL)
- find_availability: finds available time slots for attendees

Respond with JSON:
{
  "events": [...],
  "createdEvent": {...},
  "availability": [...],
  "conflicts": [...]
}`;

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
        requiresApproval: false,
      };
    } catch {
      // LLM returned freeform text — wrap gracefully
      result = {
        action: task.action,
        events: [],
        requiresApproval: false,
      };
      if (loopResult.content) {
        // Attempt to extract any useful info as a single-event list
        result.events = [];
      }
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
