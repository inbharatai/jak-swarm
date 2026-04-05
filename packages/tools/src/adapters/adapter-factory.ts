import type { EmailAdapter } from './email/email.interface.js';
import type { CalendarAdapter } from './calendar/calendar.interface.js';
import { MockEmailAdapter } from './email/mock-email.adapter.js';
import { MockCalendarAdapter } from './calendar/mock-calendar.adapter.js';
import { GmailImapAdapter } from './email/gmail-imap.adapter.js';
import { CalDAVCalendarAdapter } from './calendar/caldav-calendar.adapter.js';

export interface GmailCredentials {
  email: string;
  appPassword: string;
}

/**
 * Resolve Gmail credentials from environment variables.
 * Returns null if credentials are not available.
 */
function resolveGmailCredentials(): GmailCredentials | null {
  const email = process.env['GMAIL_EMAIL'];
  const appPassword = process.env['GMAIL_APP_PASSWORD'];

  if (email && appPassword) {
    return { email, appPassword };
  }

  return null;
}

/**
 * Get an email adapter instance.
 * Uses real Gmail IMAP adapter if credentials are available,
 * otherwise falls back to the mock adapter.
 */
export function getEmailAdapter(industry?: string): EmailAdapter {
  const creds = resolveGmailCredentials();

  if (creds) {
    return new GmailImapAdapter(creds);
  }

  return new MockEmailAdapter(industry);
}

/**
 * Get a calendar adapter instance.
 * Uses real CalDAV adapter if Gmail credentials are available,
 * otherwise falls back to the mock adapter.
 */
export function getCalendarAdapter(): CalendarAdapter {
  const creds = resolveGmailCredentials();

  if (creds) {
    return new CalDAVCalendarAdapter(creds);
  }

  return new MockCalendarAdapter();
}

/**
 * Check whether real (non-mock) adapters are available.
 */
export function hasRealAdapters(): boolean {
  return resolveGmailCredentials() !== null;
}
