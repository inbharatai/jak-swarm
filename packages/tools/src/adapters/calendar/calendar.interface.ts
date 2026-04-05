export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string; // ISO datetime
  endTime: string; // ISO datetime
  allDay: boolean;
  attendees: Array<{ email: string; name?: string; status?: 'accepted' | 'declined' | 'tentative' | 'pending' }>;
  organizer: string;
  calendarId: string;
  recurrence?: string;
  conferenceLink?: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEventFilter {
  calendarId?: string;
  after?: string; // ISO datetime
  before?: string; // ISO datetime
  query?: string;
  maxResults?: number;
  showDeclined?: boolean;
}

export interface CreateEventParams {
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  allDay?: boolean;
  attendees?: string[]; // email addresses
  calendarId?: string;
  conferenceLink?: boolean; // if true, create a meeting link
  recurrence?: string; // RRULE string
}

export interface UpdateEventParams {
  title?: string;
  description?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  addAttendees?: string[];
  removeAttendees?: string[];
  status?: 'confirmed' | 'tentative' | 'cancelled';
}

export interface AvailabilitySlot {
  startTime: string;
  endTime: string;
  available: boolean;
}

export interface CalendarAdapter {
  /**
   * List events matching the filter.
   */
  listEvents(filter: CalendarEventFilter): Promise<CalendarEvent[]>;

  /**
   * Get a specific event by ID.
   */
  getEvent(eventId: string): Promise<CalendarEvent>;

  /**
   * Create a new calendar event.
   */
  createEvent(params: CreateEventParams): Promise<CalendarEvent>;

  /**
   * Update an existing event.
   */
  updateEvent(eventId: string, updates: UpdateEventParams): Promise<CalendarEvent>;

  /**
   * Delete/cancel an event.
   * NOTE: This notifies attendees.
   */
  deleteEvent(eventId: string, notify?: boolean): Promise<void>;

  /**
   * Find availability windows for a list of attendees.
   */
  findAvailability(
    attendeeEmails: string[],
    durationMinutes: number,
    after: string,
    before: string,
  ): Promise<AvailabilitySlot[]>;
}
