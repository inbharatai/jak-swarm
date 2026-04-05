export interface CRMContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  company?: string;
  title?: string;
  stage: string;
  tags: string[];
  assignedTo?: string;
  lastActivity?: string;
  notes: CRMNote[];
  createdAt: string;
  updatedAt: string;
}

export interface CRMNote {
  id: string;
  contactId: string;
  content: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

export interface CRMDeal {
  id: string;
  name: string;
  contactId: string;
  amount: number;
  currency: string;
  stage: string;
  probability: number;
  expectedCloseDate?: string;
  assignedTo?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContactFilter {
  email?: string;
  company?: string;
  stage?: string;
  assignedTo?: string;
  tags?: string[];
  limit?: number;
}

export interface CRMAdapter {
  /**
   * List contacts with optional filters.
   */
  listContacts(filter?: ContactFilter): Promise<CRMContact[]>;

  /**
   * Get a specific contact by ID.
   */
  getContact(id: string): Promise<CRMContact>;

  /**
   * Search contacts by name, email, or company.
   */
  searchContacts(query: string): Promise<CRMContact[]>;

  /**
   * Update contact fields.
   * NOTE: This is a WRITE operation and may require approval.
   */
  updateContact(id: string, updates: Partial<CRMContact>): Promise<CRMContact>;

  /**
   * Create a new note on a contact.
   */
  createNote(contactId: string, content: string, authorId: string, authorName: string): Promise<CRMNote>;

  /**
   * List deals, optionally filtered by contact.
   */
  listDeals(contactId?: string): Promise<CRMDeal[]>;

  /**
   * Update a deal's stage or other fields.
   * NOTE: This is a WRITE operation and may require approval.
   */
  updateDealStage(dealId: string, stage: string, notes?: string): Promise<CRMDeal>;
}
