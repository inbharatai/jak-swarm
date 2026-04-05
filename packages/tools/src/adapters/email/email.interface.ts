export interface EmailAttachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId?: string;
}

export interface EmailMessage {
  id: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  bodyHtml?: string;
  date: string;
  labels: string[];
  attachments: EmailAttachment[];
  snippet?: string;
  threadId?: string;
}

export interface EmailFilter {
  from?: string;
  to?: string;
  subject?: string;
  after?: string; // ISO date string
  before?: string; // ISO date string
  labels?: string[];
  limit?: number;
  includeSpam?: boolean;
}

export interface EmailDraft {
  id: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  createdAt: string;
  updatedAt?: string;
}

export interface EmailAdapter {
  /**
   * List messages matching the given filter.
   */
  listMessages(filter: EmailFilter): Promise<EmailMessage[]>;

  /**
   * Get a specific message by ID.
   */
  getMessage(id: string): Promise<EmailMessage>;

  /**
   * Create a draft reply to an existing message.
   */
  draftReply(messageId: string, body: string): Promise<EmailDraft>;

  /**
   * Create a new draft email.
   */
  createDraft(to: string[], subject: string, body: string, cc?: string[]): Promise<EmailDraft>;

  /**
   * Send a previously created draft.
   * NOTE: This action ALWAYS requires prior human approval.
   */
  sendDraft(draftId: string): Promise<void>;

  /**
   * Search messages using a query string.
   */
  searchMessages(query: string): Promise<EmailMessage[]>;

  /**
   * Update an existing draft.
   */
  updateDraft?(draftId: string, updates: Partial<EmailDraft>): Promise<EmailDraft>;

  /**
   * Delete a draft.
   */
  deleteDraft?(draftId: string): Promise<void>;
}
