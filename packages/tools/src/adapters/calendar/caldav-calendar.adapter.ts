import { createDAVClient, type DAVCalendar, type DAVCalendarObject } from 'tsdav';
import type {
  CalendarAdapter,
  CalendarEvent,
  CalendarEventFilter,
  CreateEventParams,
  UpdateEventParams,
  AvailabilitySlot,
} from './calendar.interface.js';
import { generateId } from '@jak-swarm/shared';

type DAVClientInstance = Awaited<ReturnType<typeof createDAVClient>>;

/**
 * Real Google Calendar adapter using CalDAV protocol via tsdav.
 * Requires a Gmail App Password (not OAuth).
 */
export class CalDAVCalendarAdapter implements CalendarAdapter {
  private email: string;
  private appPassword: string;
  private clientPromise: Promise<DAVClientInstance> | null = null;
  private calendarCache: DAVCalendar[] | null = null;

  constructor(config: { email: string; appPassword: string }) {
    this.email = config.email;
    this.appPassword = config.appPassword;
  }

  private async getClient(): Promise<DAVClientInstance> {
    if (!this.clientPromise) {
      this.clientPromise = createDAVClient({
        serverUrl: 'https://apidata.googleusercontent.com/caldav/v2/',
        credentials: {
          username: this.email,
          password: this.appPassword,
        },
        authMethod: 'Basic',
        defaultAccountType: 'caldav',
      });
    }
    return this.clientPromise;
  }

  private async getCalendars(): Promise<DAVCalendar[]> {
    if (this.calendarCache) return this.calendarCache;
    const client = await this.getClient();
    this.calendarCache = await client.fetchCalendars();
    return this.calendarCache;
  }

  private async getPrimaryCalendar(): Promise<DAVCalendar> {
    const calendars = await this.getCalendars();
    // Try to find the primary calendar (usually the one matching the user's email)
    const primary = calendars.find((c) =>
      c.url.includes(encodeURIComponent(this.email)) || c.url.includes(this.email),
    );
    if (primary) return primary;
    // Fall back to the first calendar
    if (calendars.length > 0) return calendars[0]!;
    throw new Error('No calendars found for this account');
  }

  private async getCalendarById(calendarId?: string): Promise<DAVCalendar> {
    if (!calendarId || calendarId === 'primary') {
      return this.getPrimaryCalendar();
    }
    const calendars = await this.getCalendars();
    const found = calendars.find(
      (c) => c.url.includes(calendarId) || c.url === calendarId,
    );
    if (found) return found;
    return this.getPrimaryCalendar();
  }

  /**
   * Parse iCalendar VEVENT data into our CalendarEvent interface.
   */
  private parseVEvent(obj: DAVCalendarObject, calendarId: string): CalendarEvent | null {
    const ical = obj.data as string | undefined;
    if (!ical) return null;

    const uid = this.extractICalProp(ical, 'UID') ?? obj.url;
    const summary = this.extractICalProp(ical, 'SUMMARY') ?? '(No Title)';
    const description = this.extractICalProp(ical, 'DESCRIPTION');
    const location = this.extractICalProp(ical, 'LOCATION');
    const dtstart = this.extractICalProp(ical, 'DTSTART');
    const dtend = this.extractICalProp(ical, 'DTEND');
    const status = this.extractICalProp(ical, 'STATUS');
    const created = this.extractICalProp(ical, 'CREATED');
    const lastModified = this.extractICalProp(ical, 'LAST-MODIFIED');
    const rrule = this.extractICalProp(ical, 'RRULE');

    // Determine if all-day event (DATE vs DATETIME)
    const allDay = dtstart ? !dtstart.includes('T') : false;

    // Parse attendees
    const attendees = this.extractAttendees(ical);

    // Parse organizer
    const organizerLine = this.extractICalProp(ical, 'ORGANIZER');
    const organizer = organizerLine
      ? organizerLine.replace(/^mailto:/i, '').trim()
      : this.email;

    // Extract conference link from description or CONFERENCE property
    const conferenceLink = this.extractICalProp(ical, 'CONFERENCE') ??
      this.extractUrlFromText(description ?? '');

    return {
      id: uid,
      title: summary,
      description: description ?? undefined,
      location: location ?? undefined,
      startTime: this.parseICalDate(dtstart ?? ''),
      endTime: this.parseICalDate(dtend ?? dtstart ?? ''),
      allDay,
      attendees,
      organizer,
      calendarId,
      recurrence: rrule ?? undefined,
      conferenceLink: conferenceLink ?? undefined,
      status: this.mapStatus(status),
      createdAt: created ? this.parseICalDate(created) : new Date().toISOString(),
      updatedAt: lastModified ? this.parseICalDate(lastModified) : new Date().toISOString(),
    };
  }

  /**
   * Extract a property value from iCalendar text.
   * Handles both simple props (SUMMARY:value) and parameterized props (DTSTART;TZID=...:value).
   */
  private extractICalProp(ical: string, prop: string): string | null {
    // Match "PROP:" or "PROP;params:" format, handling line folding
    const regex = new RegExp(`^${prop}[;:](.*)$`, 'im');
    const match = ical.match(regex);
    if (!match?.[1]) return null;

    let value = match[1];
    // If the prop has parameters (e.g., DTSTART;TZID=America/New_York:20240101T090000)
    // extract just the value part
    if (match[0].includes(';') && value.includes(':')) {
      value = value.slice(value.lastIndexOf(':') + 1);
    }

    // Handle line folding (lines starting with space or tab are continuations)
    const startIdx = ical.indexOf(match[0]);
    const afterMatch = ical.slice(startIdx + match[0].length);
    const foldedLines = afterMatch.match(/^(?:\r?\n[ \t].+)+/m);
    if (foldedLines?.[0]) {
      value += foldedLines[0].replace(/\r?\n[ \t]/g, '');
    }

    return value.trim() || null;
  }

  /**
   * Extract attendees from iCalendar text.
   */
  private extractAttendees(ical: string): CalendarEvent['attendees'] {
    const attendees: CalendarEvent['attendees'] = [];
    const lines = ical.split(/\r?\n/);

    for (const line of lines) {
      if (!line.startsWith('ATTENDEE')) continue;

      const emailMatch = line.match(/mailto:([^\s;]+)/i);
      if (!emailMatch?.[1]) continue;

      const email = emailMatch[1];
      const cnMatch = line.match(/CN=([^;:]+)/i);
      const partstatMatch = line.match(/PARTSTAT=([^;:]+)/i);

      const partstat = partstatMatch?.[1]?.toUpperCase() ?? 'NEEDS-ACTION';
      let status: 'accepted' | 'declined' | 'tentative' | 'pending';

      switch (partstat) {
        case 'ACCEPTED':
          status = 'accepted';
          break;
        case 'DECLINED':
          status = 'declined';
          break;
        case 'TENTATIVE':
          status = 'tentative';
          break;
        default:
          status = 'pending';
      }

      attendees.push({
        email,
        name: cnMatch?.[1]?.replace(/"/g, ''),
        status,
      });
    }

    return attendees;
  }

  /**
   * Parse an iCalendar date string to ISO format.
   */
  private parseICalDate(value: string): string {
    if (!value) return new Date().toISOString();

    // Already ISO format
    if (value.includes('-')) return new Date(value).toISOString();

    // Basic format: 20240101T090000Z or 20240101T090000 or 20240101
    const cleaned = value.replace(/[^0-9TZ]/g, '');

    if (cleaned.length === 8) {
      // All-day: YYYYMMDD
      const year = cleaned.slice(0, 4);
      const month = cleaned.slice(4, 6);
      const day = cleaned.slice(6, 8);
      return `${year}-${month}-${day}T00:00:00.000Z`;
    }

    if (cleaned.length >= 15) {
      // DateTime: YYYYMMDDTHHmmss or YYYYMMDDTHHmmssZ
      const year = cleaned.slice(0, 4);
      const month = cleaned.slice(4, 6);
      const day = cleaned.slice(6, 8);
      const hour = cleaned.slice(9, 11);
      const min = cleaned.slice(11, 13);
      const sec = cleaned.slice(13, 15);
      const tz = cleaned.endsWith('Z') ? 'Z' : '';
      return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}${tz}`).toISOString();
    }

    // Fallback
    return new Date(value).toISOString();
  }

  /**
   * Format a JS Date or ISO string to iCalendar date format.
   */
  private toICalDate(isoString: string, allDay = false): string {
    const d = new Date(isoString);
    const pad = (n: number): string => String(n).padStart(2, '0');

    if (allDay) {
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
    }

    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  }

  private mapStatus(status: string | null): CalendarEvent['status'] {
    switch (status?.toUpperCase()) {
      case 'CONFIRMED':
        return 'confirmed';
      case 'TENTATIVE':
        return 'tentative';
      case 'CANCELLED':
        return 'cancelled';
      default:
        return 'confirmed';
    }
  }

  private extractUrlFromText(text: string): string | null {
    const match = text.match(/https?:\/\/[^\s<>"]+/);
    return match?.[0] ?? null;
  }

  /**
   * Build a VCALENDAR string for a VEVENT.
   */
  private buildVCalendar(params: {
    uid: string;
    summary: string;
    description?: string;
    location?: string;
    startTime: string;
    endTime: string;
    allDay?: boolean;
    attendees?: string[];
    recurrence?: string;
    status?: string;
  }): string {
    const now = this.toICalDate(new Date().toISOString());
    const dtstart = params.allDay
      ? `DTSTART;VALUE=DATE:${this.toICalDate(params.startTime, true)}`
      : `DTSTART:${this.toICalDate(params.startTime)}`;
    const dtend = params.allDay
      ? `DTEND;VALUE=DATE:${this.toICalDate(params.endTime, true)}`
      : `DTEND:${this.toICalDate(params.endTime)}`;

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//JAK Swarm//Calendar//EN',
      'BEGIN:VEVENT',
      `UID:${params.uid}`,
      `DTSTAMP:${now}`,
      dtstart,
      dtend,
      `SUMMARY:${params.summary}`,
    ];

    if (params.description) lines.push(`DESCRIPTION:${params.description}`);
    if (params.location) lines.push(`LOCATION:${params.location}`);
    if (params.recurrence) lines.push(`RRULE:${params.recurrence}`);

    lines.push(`STATUS:${(params.status ?? 'CONFIRMED').toUpperCase()}`);

    if (params.attendees) {
      for (const email of params.attendees) {
        lines.push(`ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:${email}`);
      }
    }

    lines.push(`ORGANIZER:mailto:${this.email}`);
    lines.push('END:VEVENT');
    lines.push('END:VCALENDAR');

    return lines.join('\r\n');
  }

  async listEvents(filter: CalendarEventFilter): Promise<CalendarEvent[]> {
    const client = await this.getClient();
    const calendar = await this.getCalendarById(filter.calendarId);

    const timeRange = (filter.after || filter.before)
      ? {
          start: filter.after ?? new Date(Date.now() - 30 * 86400000).toISOString(),
          end: filter.before ?? new Date(Date.now() + 90 * 86400000).toISOString(),
        }
      : {
          start: new Date(Date.now() - 7 * 86400000).toISOString(),
          end: new Date(Date.now() + 30 * 86400000).toISOString(),
        };

    const objects = await client.fetchCalendarObjects({
      calendar,
      timeRange,
      expand: true,
    });

    let events: CalendarEvent[] = [];
    for (const obj of objects) {
      const event = this.parseVEvent(obj, filter.calendarId ?? 'primary');
      if (event) events.push(event);
    }

    // Apply query filter
    if (filter.query) {
      const lower = filter.query.toLowerCase();
      events = events.filter(
        (e) =>
          e.title.toLowerCase().includes(lower) ||
          (e.description?.toLowerCase().includes(lower) ?? false),
      );
    }

    // Filter declined events
    if (!filter.showDeclined) {
      events = events.filter((e) => e.status !== 'cancelled');
    }

    // Sort by start time
    events.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    return events.slice(0, filter.maxResults ?? 20);
  }

  async getEvent(eventId: string): Promise<CalendarEvent> {
    const client = await this.getClient();
    const calendars = await this.getCalendars();

    // Search across all calendars for the event
    for (const calendar of calendars) {
      const objects = await client.fetchCalendarObjects({ calendar });

      for (const obj of objects) {
        const event = this.parseVEvent(obj, 'primary');
        if (event && (event.id === eventId || obj.url.includes(eventId))) {
          return event;
        }
      }
    }

    throw new Error(`Calendar event '${eventId}' not found`);
  }

  async createEvent(params: CreateEventParams): Promise<CalendarEvent> {
    const client = await this.getClient();
    const calendar = await this.getCalendarById(params.calendarId);

    const uid = `${generateId('evt')}@jak-swarm`;
    const filename = `${uid}.ics`;

    const icalString = this.buildVCalendar({
      uid,
      summary: params.title,
      description: params.description,
      location: params.location,
      startTime: params.startTime,
      endTime: params.endTime,
      allDay: params.allDay,
      attendees: params.attendees,
      recurrence: params.recurrence,
    });

    await client.createCalendarObject({
      calendar,
      iCalString: icalString,
      filename,
    });

    // Return the created event
    return {
      id: uid,
      title: params.title,
      description: params.description,
      location: params.location,
      startTime: params.startTime,
      endTime: params.endTime,
      allDay: params.allDay ?? false,
      attendees: (params.attendees ?? []).map((email) => ({ email, status: 'pending' as const })),
      organizer: this.email,
      calendarId: params.calendarId ?? 'primary',
      recurrence: params.recurrence,
      status: 'confirmed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async updateEvent(eventId: string, updates: UpdateEventParams): Promise<CalendarEvent> {
    const client = await this.getClient();
    const calendars = await this.getCalendars();

    // Find the calendar object that contains this event
    for (const calendar of calendars) {
      const objects = await client.fetchCalendarObjects({ calendar });

      for (const obj of objects) {
        const event = this.parseVEvent(obj, 'primary');
        if (event && (event.id === eventId || obj.url.includes(eventId))) {
          // Apply updates
          const updated: CalendarEvent = {
            ...event,
            ...(updates.title !== undefined ? { title: updates.title } : {}),
            ...(updates.description !== undefined ? { description: updates.description } : {}),
            ...(updates.location !== undefined ? { location: updates.location } : {}),
            ...(updates.startTime !== undefined ? { startTime: updates.startTime } : {}),
            ...(updates.endTime !== undefined ? { endTime: updates.endTime } : {}),
            ...(updates.status !== undefined ? { status: updates.status } : {}),
            updatedAt: new Date().toISOString(),
          };

          // Handle attendee changes
          if (updates.addAttendees) {
            updated.attendees = [
              ...updated.attendees,
              ...updates.addAttendees.map((email) => ({ email, status: 'pending' as const })),
            ];
          }
          if (updates.removeAttendees) {
            const removeSet = new Set(updates.removeAttendees);
            updated.attendees = updated.attendees.filter((a) => !removeSet.has(a.email));
          }

          // Build updated iCalendar string
          const icalString = this.buildVCalendar({
            uid: event.id,
            summary: updated.title,
            description: updated.description,
            location: updated.location,
            startTime: updated.startTime,
            endTime: updated.endTime,
            allDay: updated.allDay,
            attendees: updated.attendees.map((a) => a.email),
            recurrence: updated.recurrence,
            status: updated.status,
          });

          await client.updateCalendarObject({
            calendarObject: { ...obj, data: icalString },
          });

          return updated;
        }
      }
    }

    throw new Error(`Calendar event '${eventId}' not found`);
  }

  async deleteEvent(eventId: string, _notify?: boolean): Promise<void> {
    const client = await this.getClient();
    const calendars = await this.getCalendars();

    for (const calendar of calendars) {
      const objects = await client.fetchCalendarObjects({ calendar });

      for (const obj of objects) {
        const event = this.parseVEvent(obj, 'primary');
        if (event && (event.id === eventId || obj.url.includes(eventId))) {
          await client.deleteCalendarObject({
            calendarObject: obj,
          });
          return;
        }
      }
    }

    throw new Error(`Calendar event '${eventId}' not found`);
  }

  async findAvailability(
    _attendeeEmails: string[],
    durationMinutes: number,
    after: string,
    before: string,
  ): Promise<AvailabilitySlot[]> {
    // Fetch all events in the range from the primary calendar
    const events = await this.listEvents({
      after,
      before,
      maxResults: 250,
    });

    // Build busy intervals
    const busyIntervals = events.map((e) => ({
      start: new Date(e.startTime).getTime(),
      end: new Date(e.endTime).getTime(),
    }));

    // Sort by start time
    busyIntervals.sort((a, b) => a.start - b.start);

    // Find free windows during business hours (9 AM - 5 PM)
    const slots: AvailabilitySlot[] = [];
    const startDate = new Date(after);
    const endDate = new Date(before);
    const durationMs = durationMinutes * 60000;

    const current = new Date(startDate);
    current.setHours(9, 0, 0, 0);
    if (current < startDate) current.setDate(current.getDate() + 1);

    while (current < endDate && slots.length < 20) {
      const day = current.getDay();
      // Skip weekends
      if (day === 0 || day === 6) {
        current.setDate(current.getDate() + 1);
        current.setHours(9, 0, 0, 0);
        continue;
      }

      const hour = current.getHours();
      if (hour >= 17) {
        // Past business hours, move to next day
        current.setDate(current.getDate() + 1);
        current.setHours(9, 0, 0, 0);
        continue;
      }

      if (hour < 9) {
        current.setHours(9, 0, 0, 0);
        continue;
      }

      const slotStart = current.getTime();
      const slotEnd = slotStart + durationMs;

      // Check if slot fits within business hours
      const endHour = new Date(slotEnd).getHours();
      const endMin = new Date(slotEnd).getMinutes();
      if (endHour > 17 || (endHour === 17 && endMin > 0)) {
        current.setDate(current.getDate() + 1);
        current.setHours(9, 0, 0, 0);
        continue;
      }

      // Check if slot overlaps with any busy interval
      const isBusy = busyIntervals.some(
        (busy) => slotStart < busy.end && slotEnd > busy.start,
      );

      if (!isBusy) {
        slots.push({
          startTime: new Date(slotStart).toISOString(),
          endTime: new Date(slotEnd).toISOString(),
          available: true,
        });
      }

      // Move to next 30-minute slot
      current.setMinutes(current.getMinutes() + 30);
    }

    return slots;
  }
}
