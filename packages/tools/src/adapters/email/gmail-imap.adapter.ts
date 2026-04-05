import { ImapFlow } from 'imapflow';
import type { FetchMessageObject, SearchObject } from 'imapflow';
import nodemailer from 'nodemailer';
import type { EmailAdapter, EmailMessage, EmailFilter, EmailDraft } from './email.interface.js';
import { generateId } from '@jak-swarm/shared';

/**
 * Real Gmail adapter using IMAP (imapflow) for reading and SMTP (nodemailer) for sending.
 * Requires a Gmail App Password (not OAuth).
 */
export class GmailImapAdapter implements EmailAdapter {
  private email: string;
  private appPassword: string;
  private drafts = new Map<string, EmailDraft & { to: string[]; cc?: string[] }>();
  private transporter: nodemailer.Transporter;

  constructor(config: { email: string; appPassword: string }) {
    this.email = config.email;
    this.appPassword = config.appPassword;
    this.transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: this.email, pass: this.appPassword },
    });
  }

  /**
   * Execute a function with an IMAP connection, ensuring proper cleanup.
   */
  private async withImap<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: this.email, pass: this.appPassword },
      logger: false,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });

    await client.connect();
    try {
      return await fn(client);
    } finally {
      try {
        await client.logout();
      } catch {
        // Ignore logout errors during cleanup
      }
    }
  }

  /**
   * Parse a FetchMessageObject into our EmailMessage interface.
   */
  private parseMessage(msg: FetchMessageObject): EmailMessage {
    const envelope = msg.envelope;
    const fromAddr =
      envelope?.from?.[0]?.address
        ? envelope.from[0].name
          ? `${envelope.from[0].name} <${envelope.from[0].address}>`
          : envelope.from[0].address
        : 'unknown';

    const toAddrs = (envelope?.to ?? []).map(
      (a) => a.address ?? 'unknown',
    );
    const ccAddrs = (envelope?.cc ?? []).map(
      (a) => a.address ?? 'unknown',
    );

    // Parse body from source or body parts
    let bodyText = '';
    let bodyHtml: string | undefined;

    if (msg.source) {
      const raw = msg.source.toString('utf-8');
      // Attempt to extract text body from raw message
      const { text, html } = this.extractBodyFromRaw(raw);
      bodyText = text;
      bodyHtml = html;
    } else if (msg.bodyParts) {
      // Try text/plain first, then text/html
      for (const [key, value] of msg.bodyParts) {
        const content = value.toString('utf-8');
        if (key.toLowerCase().includes('text')) {
          bodyText = content;
        }
        if (key.toLowerCase().includes('html')) {
          bodyHtml = content;
        }
      }
      if (!bodyText && bodyHtml) {
        bodyText = this.stripHtml(bodyHtml);
      }
    }

    // Map IMAP flags to labels
    const labels = this.flagsToLabels(msg.flags);

    // Generate snippet from body
    const snippet = bodyText.slice(0, 200).replace(/\s+/g, ' ').trim();

    return {
      id: String(msg.uid),
      from: fromAddr,
      to: toAddrs,
      cc: ccAddrs.length > 0 ? ccAddrs : undefined,
      subject: envelope?.subject ?? '(no subject)',
      body: bodyText,
      bodyHtml,
      date: envelope?.date
        ? new Date(envelope.date).toISOString()
        : msg.internalDate
          ? new Date(msg.internalDate).toISOString()
          : new Date().toISOString(),
      labels,
      attachments: this.extractAttachments(msg),
      snippet,
      threadId: msg.threadId ?? undefined,
    };
  }

  /**
   * Extract text and html bodies from raw MIME message.
   */
  private extractBodyFromRaw(raw: string): { text: string; html?: string } {
    let text = '';
    let html: string | undefined;

    // Simple MIME parser: look for Content-Type boundaries
    const boundaryMatch = raw.match(/boundary="?([^"\r\n;]+)"?/i);

    if (boundaryMatch?.[1]) {
      const boundary = boundaryMatch[1];
      const parts = raw.split(`--${boundary}`);

      for (const part of parts) {
        const contentTypeMatch = part.match(/Content-Type:\s*([^\r\n;]+)/i);
        const contentType = contentTypeMatch?.[1]?.trim().toLowerCase() ?? '';

        // Find the body (after double newline)
        const bodyStart = part.indexOf('\r\n\r\n');
        if (bodyStart === -1) continue;
        let body = part.slice(bodyStart + 4).trim();

        // Check transfer encoding
        const encodingMatch = part.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
        const encoding = encodingMatch?.[1]?.trim().toLowerCase() ?? '';
        if (encoding === 'base64') {
          try {
            body = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf-8');
          } catch {
            // Keep as-is if decode fails
          }
        } else if (encoding === 'quoted-printable') {
          body = this.decodeQuotedPrintable(body);
        }

        if (contentType.startsWith('text/plain') && !text) {
          text = body;
        } else if (contentType.startsWith('text/html') && !html) {
          html = body;
        }
      }
    } else {
      // No MIME boundaries — treat as plain text
      const bodyStart = raw.indexOf('\r\n\r\n');
      if (bodyStart !== -1) {
        text = raw.slice(bodyStart + 4).trim();
      }
    }

    if (!text && html) {
      text = this.stripHtml(html);
    }

    return { text, html };
  }

  private decodeQuotedPrintable(input: string): string {
    return input
      .replace(/=\r?\n/g, '') // soft line breaks
      .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .trim();
  }

  /**
   * Map IMAP flags to human-readable labels.
   */
  private flagsToLabels(flags?: Set<string>): string[] {
    if (!flags) return ['INBOX'];
    const labels: string[] = ['INBOX'];
    if (flags.has('\\Seen')) labels.push('READ');
    if (flags.has('\\Flagged')) labels.push('STARRED');
    if (flags.has('\\Answered')) labels.push('REPLIED');
    if (flags.has('\\Draft')) labels.push('DRAFT');
    if (flags.has('\\Deleted')) labels.push('TRASH');
    if (!flags.has('\\Seen')) labels.push('UNREAD');
    return labels;
  }

  /**
   * Extract attachment info from body structure.
   */
  private extractAttachments(msg: FetchMessageObject): EmailMessage['attachments'] {
    const attachments: EmailMessage['attachments'] = [];
    if (!msg.bodyStructure) return attachments;

    const walk = (node: typeof msg.bodyStructure): void => {
      if (!node) return;
      if (
        node.disposition === 'attachment' ||
        (node.dispositionParameters?.['filename'])
      ) {
        attachments.push({
          filename:
            node.dispositionParameters?.['filename'] ??
            node.parameters?.['name'] ??
            'attachment',
          mimeType: node.type,
          size: node.size ?? 0,
          attachmentId: node.part,
        });
      }
      if (node.childNodes) {
        for (const child of node.childNodes) {
          walk(child);
        }
      }
    };

    walk(msg.bodyStructure);
    return attachments;
  }

  /**
   * Build IMAP search criteria from EmailFilter.
   */
  private buildSearchCriteria(filter: EmailFilter): SearchObject {
    const criteria: SearchObject = {};

    if (filter.from) criteria.from = filter.from;
    if (filter.to) criteria.to = filter.to;
    if (filter.subject) criteria.subject = filter.subject;
    if (filter.after) criteria.since = new Date(filter.after);
    if (filter.before) criteria.before = new Date(filter.before);

    return criteria;
  }

  async listMessages(filter: EmailFilter): Promise<EmailMessage[]> {
    return this.withImap(async (client) => {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const searchCriteria = this.buildSearchCriteria(filter);
        // If no criteria specified, just get recent messages
        if (Object.keys(searchCriteria).length === 0) {
          searchCriteria.all = true;
        }

        const uids = await client.search(searchCriteria, { uid: true });
        if (!uids || uids.length === 0) return [];

        const limit = filter.limit ?? 20;
        // Take only the last N UIDs (most recent)
        const targetUids = uids.slice(-limit);

        const messages: EmailMessage[] = [];
        const fetchOptions = {
          uid: true,
          envelope: true,
          flags: true,
          bodyStructure: true,
          source: true,
          internalDate: true,
          threadId: true,
        };

        for await (const msg of client.fetch(targetUids.join(','), fetchOptions, { uid: true })) {
          messages.push(this.parseMessage(msg));
        }

        // Sort by date descending (newest first)
        messages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return messages.slice(0, limit);
      } finally {
        lock.release();
      }
    });
  }

  async getMessage(id: string): Promise<EmailMessage> {
    return this.withImap(async (client) => {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const msg = await client.fetchOne(id, {
          uid: true,
          envelope: true,
          flags: true,
          bodyStructure: true,
          source: true,
          internalDate: true,
          threadId: true,
        }, { uid: true });

        if (!msg) {
          throw new Error(`Email with UID '${id}' not found`);
        }

        return this.parseMessage(msg);
      } finally {
        lock.release();
      }
    });
  }

  async draftReply(messageId: string, body: string): Promise<EmailDraft> {
    // Fetch original message to get sender info
    const original = await this.getMessage(messageId);

    const draft: EmailDraft & { to: string[]; cc?: string[] } = {
      id: generateId('draft_'),
      to: [original.from.replace(/.*<(.+)>.*/, '$1')], // Extract email from "Name <email>"
      subject: `Re: ${original.subject}`,
      body,
      createdAt: new Date().toISOString(),
    };

    this.drafts.set(draft.id, draft);
    return draft;
  }

  async createDraft(to: string[], subject: string, body: string, cc?: string[]): Promise<EmailDraft> {
    const draft: EmailDraft & { to: string[]; cc?: string[] } = {
      id: generateId('draft_'),
      to,
      cc,
      subject,
      body,
      createdAt: new Date().toISOString(),
    };

    this.drafts.set(draft.id, draft);
    return draft;
  }

  async sendDraft(draftId: string): Promise<void> {
    const draft = this.drafts.get(draftId);
    if (!draft) {
      throw new Error(`Draft '${draftId}' not found`);
    }

    try {
      await this.transporter.sendMail({
        from: this.email,
        to: draft.to.join(', '),
        cc: draft.cc?.join(', '),
        subject: draft.subject,
        text: draft.body,
      });

      this.drafts.delete(draftId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to send email: ${message}`);
    }
  }

  async searchMessages(query: string): Promise<EmailMessage[]> {
    return this.withImap(async (client) => {
      const lock = await client.getMailboxLock('INBOX');
      try {
        // Use Gmail's X-GM-RAW search if available, otherwise fall back to text search
        const searchCriteria: SearchObject = {};

        // Gmail supports raw search queries via X-GM-RAW
        if (client.capabilities.has('X-GM-EXT-1')) {
          searchCriteria.gmraw = query;
        } else {
          // Fall back to basic text search
          searchCriteria.text = query;
        }

        const uids = await client.search(searchCriteria, { uid: true });
        if (!uids || uids.length === 0) return [];

        // Limit to 20 results
        const targetUids = uids.slice(-20);

        const messages: EmailMessage[] = [];
        for await (const msg of client.fetch(targetUids.join(','), {
          uid: true,
          envelope: true,
          flags: true,
          bodyStructure: true,
          source: true,
          internalDate: true,
          threadId: true,
        }, { uid: true })) {
          messages.push(this.parseMessage(msg));
        }

        messages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return messages;
      } finally {
        lock.release();
      }
    });
  }

  async updateDraft(draftId: string, updates: Partial<EmailDraft>): Promise<EmailDraft> {
    const existing = this.drafts.get(draftId);
    if (!existing) throw new Error(`Draft '${draftId}' not found`);
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.drafts.set(draftId, updated);
    return updated;
  }

  async deleteDraft(draftId: string): Promise<void> {
    this.drafts.delete(draftId);
  }
}
