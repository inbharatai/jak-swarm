import type {
  CalendarAdapter,
  CalendarEvent,
  CalendarEventFilter,
  CreateEventParams,
  UpdateEventParams,
  AvailabilitySlot,
} from './calendar.interface.js';
// generateId removed with the write-path removal — mock adapter no longer
// invents new IDs now that create/update/delete throw NotConfigured.

const now = new Date();
const tomorrow = new Date(now.getTime() + 86400000);
const dayAfter = new Date(now.getTime() + 2 * 86400000);

function isoDate(d: Date): string {
  return d.toISOString();
}

function addHours(d: Date, h: number): Date {
  return new Date(d.getTime() + h * 3600000);
}

const MOCK_EVENTS: CalendarEvent[] = [
  {
    id: 'cal_001',
    title: 'Weekly Team Standup',
    description: 'Weekly sync on project status and blockers',
    startTime: isoDate(new Date(tomorrow.setHours(9, 0, 0, 0))),
    endTime: isoDate(addHours(new Date(tomorrow.setHours(9, 0, 0, 0)), 1)),
    allDay: false,
    attendees: [
      { email: 'alice@company.com', name: 'Alice', status: 'accepted' },
      { email: 'bob@company.com', name: 'Bob', status: 'accepted' },
      { email: 'carol@company.com', name: 'Carol', status: 'tentative' },
    ],
    organizer: 'manager@company.com',
    calendarId: 'primary',
    conferenceLink: 'https://meet.google.com/abc-defg-hij',
    status: 'confirmed',
    createdAt: isoDate(new Date(Date.now() - 7 * 86400000)),
    updatedAt: isoDate(new Date(Date.now() - 86400000)),
  },
  {
    id: 'cal_002',
    title: 'Client Demo - Acme Corp',
    description: 'Product demonstration for Acme Corp. Prepare slides and live demo environment.',
    location: 'Zoom: https://zoom.us/j/123456789',
    startTime: isoDate(new Date(dayAfter.setHours(14, 0, 0, 0))),
    endTime: isoDate(addHours(new Date(dayAfter.setHours(14, 0, 0, 0)), 1)),
    allDay: false,
    attendees: [
      { email: 'sarah@acmecorp.com', name: 'Sarah Johnson', status: 'accepted' },
      { email: 'john@acmecorp.com', name: 'John Smith', status: 'pending' },
      { email: 'sales@company.com', name: 'Sales Team', status: 'accepted' },
    ],
    organizer: 'sales@company.com',
    calendarId: 'primary',
    status: 'confirmed',
    createdAt: isoDate(new Date(Date.now() - 3 * 86400000)),
    updatedAt: isoDate(new Date(Date.now() - 86400000)),
  },
  {
    id: 'cal_003',
    title: '1:1 with Manager',
    description: 'Monthly 1:1 check-in',
    startTime: isoDate(new Date(now.setHours(15, 0, 0, 0))),
    endTime: isoDate(addHours(new Date(now.setHours(15, 0, 0, 0)), 1)),
    allDay: false,
    attendees: [
      { email: 'manager@company.com', name: 'Manager', status: 'accepted' },
      { email: 'user@company.com', name: 'User', status: 'accepted' },
    ],
    organizer: 'manager@company.com',
    calendarId: 'primary',
    status: 'confirmed',
    createdAt: isoDate(new Date(Date.now() - 14 * 86400000)),
    updatedAt: isoDate(new Date(Date.now() - 14 * 86400000)),
  },
  {
    id: 'cal_004',
    title: 'All-Hands Meeting',
    description: 'Company-wide all-hands meeting. Q1 results and Q2 planning.',
    startTime: isoDate(new Date(Date.now() + 3 * 86400000)),
    endTime: isoDate(new Date(Date.now() + 3 * 86400000 + 7200000)),
    allDay: false,
    attendees: [{ email: 'all@company.com', name: 'All Staff', status: 'accepted' }],
    organizer: 'ceo@company.com',
    calendarId: 'primary',
    conferenceLink: 'https://meet.google.com/xyz-uvw-123',
    status: 'confirmed',
    createdAt: isoDate(new Date(Date.now() - 5 * 86400000)),
    updatedAt: isoDate(new Date(Date.now() - 2 * 86400000)),
  },
  {
    id: 'cal_005',
    title: 'Doctor Appointment (OOO)',
    description: 'Personal - Out of Office',
    startTime: isoDate(new Date(Date.now() + 4 * 86400000)),
    endTime: isoDate(new Date(Date.now() + 4 * 86400000 + 3600000)),
    allDay: false,
    attendees: [],
    organizer: 'user@company.com',
    calendarId: 'personal',
    status: 'confirmed',
    createdAt: isoDate(new Date(Date.now() - 10 * 86400000)),
    updatedAt: isoDate(new Date(Date.now() - 10 * 86400000)),
  },
];

const eventStore = new Map<string, CalendarEvent>(MOCK_EVENTS.map((e) => [e.id, e]));

export class MockCalendarAdapter implements CalendarAdapter {
  async listEvents(filter: CalendarEventFilter): Promise<CalendarEvent[]> {
    let results = [...eventStore.values()];

    if (filter.calendarId) {
      results = results.filter((e) => e.calendarId === filter.calendarId);
    }
    if (filter.after) {
      const afterDate = new Date(filter.after);
      results = results.filter((e) => new Date(e.startTime) >= afterDate);
    }
    if (filter.before) {
      const beforeDate = new Date(filter.before);
      results = results.filter((e) => new Date(e.startTime) <= beforeDate);
    }
    if (filter.query) {
      const lower = filter.query.toLowerCase();
      results = results.filter(
        (e) =>
          e.title.toLowerCase().includes(lower) ||
          (e.description?.toLowerCase().includes(lower) ?? false),
      );
    }
    if (!filter.showDeclined) {
      results = results.filter((e) => e.status !== 'cancelled');
    }

    return results
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, filter.maxResults ?? 20)
      .map((e) => ({ ...e, _mock: true } as CalendarEvent));
  }

  async getEvent(eventId: string): Promise<CalendarEvent> {
    const event = eventStore.get(eventId);
    if (!event) throw new Error(`Event '${eventId}' not found`);
    return event;
  }

  // Stage 1 honesty fix: write operations THROW instead of pretending
  // to succeed while embedding _mock/_notice metadata in the return. The
  // previous pattern let callers see what looked like a real event + then
  // relied on them checking `_notice` — which nothing did. Now the tool
  // layer gets a clear error that propagates straight to chat:
  // "Calendar not connected — please connect Google Calendar".

  async createEvent(_params: CreateEventParams): Promise<CalendarEvent> {
    throw new Error(
      'Calendar integration not connected — event NOT created. Connect Google Calendar in Settings > Integrations.',
    );
  }

  async updateEvent(_eventId: string, _updates: UpdateEventParams): Promise<CalendarEvent> {
    throw new Error(
      'Calendar integration not connected — event NOT updated. Connect Google Calendar in Settings > Integrations.',
    );
  }

  async deleteEvent(_eventId: string, _notify = true): Promise<void> {
    throw new Error(
      'Calendar integration not connected — event NOT deleted. Connect Google Calendar in Settings > Integrations.',
    );
  }

  async findAvailability(
    _attendeeEmails: string[],
    durationMinutes: number,
    after: string,
    before: string,
  ): Promise<AvailabilitySlot[]> {
    const start = new Date(after);
    const end = new Date(before);
    const slots: AvailabilitySlot[] = [];

    // Generate mock 30-minute slots during business hours
    const current = new Date(start);
    while (current < end && slots.length < 10) {
      const hour = current.getHours();
      if (hour >= 9 && hour < 17) {
        const slotEnd = new Date(current.getTime() + durationMinutes * 60000);
        // Mock: mark every other slot as available
        const available = Math.floor(current.getTime() / (30 * 60000)) % 2 === 0;
        slots.push({
          startTime: current.toISOString(),
          endTime: slotEnd.toISOString(),
          available,
        });
      }
      current.setMinutes(current.getMinutes() + 30);
    }

    return slots.filter((s) => s.available);
  }
}
