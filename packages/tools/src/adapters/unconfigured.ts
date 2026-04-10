/**
 * Unconfigured adapter stubs.
 *
 * These replace mock adapters — instead of returning fake data silently,
 * every method throws a clear error telling the operator which env vars
 * to set.  Tools still register so they appear in listings, but
 * executing them without real credentials fails loudly.
 */

import type { EmailAdapter, EmailMessage, EmailDraft, EmailFilter } from './email/email.interface.js';
import type {
  CalendarAdapter,
  CalendarEvent,
  CalendarEventFilter,
  CreateEventParams,
  UpdateEventParams,
  AvailabilitySlot,
} from './calendar/calendar.interface.js';
import type {
  CRMAdapter,
  CRMContact,
  CRMNote,
  CRMDeal,
  ContactFilter,
} from './crm/crm.interface.js';

function notConfigured(adapter: string, envHint: string): never {
  throw new Error(
    `[${adapter}] Not configured. Set ${envHint} environment variables to enable this integration.`,
  );
}

// ── Email ─────────────────────────────────────────────────────────────────

export class UnconfiguredEmailAdapter implements EmailAdapter {
  private fail(): never {
    return notConfigured('Email', 'GMAIL_EMAIL + GMAIL_APP_PASSWORD');
  }
  async listMessages(_filter: EmailFilter): Promise<EmailMessage[]> { return this.fail(); }
  async getMessage(_id: string): Promise<EmailMessage> { return this.fail(); }
  async draftReply(_messageId: string, _body: string): Promise<EmailDraft> { return this.fail(); }
  async createDraft(_to: string[], _subject: string, _body: string, _cc?: string[]): Promise<EmailDraft> { return this.fail(); }
  async sendDraft(_draftId: string): Promise<void> { return this.fail(); }
  async searchMessages(_query: string): Promise<EmailMessage[]> { return this.fail(); }
}

// ── Calendar ──────────────────────────────────────────────────────────────

export class UnconfiguredCalendarAdapter implements CalendarAdapter {
  private fail(): never {
    return notConfigured('Calendar', 'GMAIL_EMAIL + GMAIL_APP_PASSWORD');
  }
  async listEvents(_filter: CalendarEventFilter): Promise<CalendarEvent[]> { return this.fail(); }
  async getEvent(_eventId: string): Promise<CalendarEvent> { return this.fail(); }
  async createEvent(_params: CreateEventParams): Promise<CalendarEvent> { return this.fail(); }
  async updateEvent(_eventId: string, _updates: UpdateEventParams): Promise<CalendarEvent> { return this.fail(); }
  async deleteEvent(_eventId: string, _notify?: boolean): Promise<void> { return this.fail(); }
  async findAvailability(
    _attendeeEmails: string[],
    _durationMinutes: number,
    _after: string,
    _before: string,
  ): Promise<AvailabilitySlot[]> { return this.fail(); }
}

// ── CRM ───────────────────────────────────────────────────────────────────

export class UnconfiguredCRMAdapter implements CRMAdapter {
  private fail(): never {
    return notConfigured('CRM', 'a CRM provider (no CRM adapter is currently available)');
  }
  async listContacts(_filter?: ContactFilter): Promise<CRMContact[]> { return this.fail(); }
  async getContact(_id: string): Promise<CRMContact> { return this.fail(); }
  async searchContacts(_query: string): Promise<CRMContact[]> { return this.fail(); }
  async updateContact(_id: string, _updates: Partial<CRMContact>): Promise<CRMContact> { return this.fail(); }
  async createNote(_contactId: string, _content: string, _authorId: string, _authorName: string): Promise<CRMNote> { return this.fail(); }
  async listDeals(_contactId?: string): Promise<CRMDeal[]> { return this.fail(); }
  async updateDealStage(_dealId: string, _stage: string, _notes?: string): Promise<CRMDeal> { return this.fail(); }
}
