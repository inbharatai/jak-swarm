import type {
  CRMAdapter,
  CRMContact,
  CRMNote,
  CRMDeal,
  ContactFilter,
} from './crm.interface.js';
// generateId no longer needed — write methods now throw before allocating ids.

const MOCK_CONTACTS: CRMContact[] = [
  {
    id: 'contact_001',
    firstName: 'Sarah',
    lastName: 'Johnson',
    email: 'sarah.johnson@acmecorp.com',
    phone: '+1-555-0101',
    company: 'Acme Corp',
    title: 'VP of Operations',
    stage: 'Negotiation',
    tags: ['enterprise', 'high-priority'],
    assignedTo: 'sales@company.com',
    lastActivity: new Date(Date.now() - 86400000).toISOString(),
    notes: [],
    createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'contact_002',
    firstName: 'Michael',
    lastName: 'Chen',
    email: 'michael.chen@techstart.io',
    phone: '+1-555-0202',
    company: 'TechStart Inc',
    title: 'CTO',
    stage: 'Proposal',
    tags: ['startup', 'technical-buyer'],
    assignedTo: 'sales@company.com',
    lastActivity: new Date(Date.now() - 3 * 86400000).toISOString(),
    notes: [],
    createdAt: new Date(Date.now() - 45 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: 'contact_003',
    firstName: 'Emily',
    lastName: 'Rodriguez',
    email: 'emily.rodriguez@globalfin.com',
    phone: '+1-555-0303',
    company: 'Global Finance Ltd',
    title: 'Director of IT',
    stage: 'Discovery',
    tags: ['finance', 'compliance-sensitive'],
    assignedTo: 'enterprise@company.com',
    lastActivity: new Date(Date.now() - 7 * 86400000).toISOString(),
    notes: [],
    createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
  },
  {
    id: 'contact_004',
    firstName: 'David',
    lastName: 'Kim',
    email: 'david.kim@healthsys.org',
    phone: '+1-555-0404',
    company: 'HealthSystems Group',
    title: 'Chief Medical Officer',
    stage: 'Closed Won',
    tags: ['healthcare', 'champion'],
    assignedTo: 'sales@company.com',
    lastActivity: new Date(Date.now() - 14 * 86400000).toISOString(),
    notes: [],
    createdAt: new Date(Date.now() - 180 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 14 * 86400000).toISOString(),
  },
  {
    id: 'contact_005',
    firstName: 'Jennifer',
    lastName: 'Walsh',
    email: 'jennifer.walsh@retailgroup.com',
    phone: '+1-555-0505',
    company: 'Retail Group Inc',
    title: 'Head of Technology',
    stage: 'Prospecting',
    tags: ['retail', 'new-lead'],
    lastActivity: new Date(Date.now() - 2 * 86400000).toISOString(),
    notes: [],
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: 'contact_006',
    firstName: 'Robert',
    lastName: 'Martinez',
    email: 'r.martinez@logistics-co.com',
    phone: '+1-555-0606',
    company: 'LogisticsCo',
    title: 'Operations Manager',
    stage: 'Qualification',
    tags: ['logistics', 'mid-market'],
    assignedTo: 'sales@company.com',
    lastActivity: new Date(Date.now() - 5 * 86400000).toISOString(),
    notes: [],
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    id: 'contact_007',
    firstName: 'Amanda',
    lastName: 'Foster',
    email: 'amanda@legalpartners.com',
    phone: '+1-555-0707',
    company: 'Foster & Partners LLP',
    title: 'Managing Partner',
    stage: 'Negotiation',
    tags: ['legal', 'high-value'],
    assignedTo: 'enterprise@company.com',
    lastActivity: new Date(Date.now() - 86400000).toISOString(),
    notes: [],
    createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'contact_008',
    firstName: 'Thomas',
    lastName: 'Parker',
    email: 'tparker@edulearn.edu',
    phone: '+1-555-0808',
    company: 'EduLearn University',
    title: 'Director of Technology',
    stage: 'Proposal',
    tags: ['education', 'non-profit-pricing'],
    assignedTo: 'sales@company.com',
    lastActivity: new Date(Date.now() - 4 * 86400000).toISOString(),
    notes: [],
    createdAt: new Date(Date.now() - 25 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
  },
  {
    id: 'contact_009',
    firstName: 'Lisa',
    lastName: 'Nguyen',
    email: 'lisa.nguyen@insureall.com',
    phone: '+1-555-0909',
    company: 'InsureAll Corp',
    title: 'SVP Technology',
    stage: 'Discovery',
    tags: ['insurance', 'enterprise'],
    assignedTo: 'enterprise@company.com',
    lastActivity: new Date(Date.now() - 6 * 86400000).toISOString(),
    notes: [],
    createdAt: new Date(Date.now() - 35 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 6 * 86400000).toISOString(),
  },
  {
    id: 'contact_010',
    firstName: 'James',
    lastName: 'Brown',
    email: 'james.brown@hotelgroup.com',
    phone: '+1-555-1010',
    company: 'Grand Hotel Group',
    title: 'VP Digital Transformation',
    stage: 'Closed Lost',
    tags: ['hospitality', 'revisit-q3'],
    assignedTo: 'sales@company.com',
    lastActivity: new Date(Date.now() - 30 * 86400000).toISOString(),
    notes: [],
    createdAt: new Date(Date.now() - 120 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
  },
];

const MOCK_DEALS: CRMDeal[] = [
  {
    id: 'deal_001',
    name: 'Acme Corp - Enterprise License',
    contactId: 'contact_001',
    amount: 185000,
    currency: 'USD',
    stage: 'Negotiation',
    probability: 75,
    expectedCloseDate: new Date(Date.now() + 30 * 86400000).toISOString(),
    assignedTo: 'sales@company.com',
    notes: 'Customer requesting net-60 payment terms. Legal review in progress.',
    createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'deal_002',
    name: 'TechStart - Professional Plan',
    contactId: 'contact_002',
    amount: 24000,
    currency: 'USD',
    stage: 'Proposal',
    probability: 50,
    expectedCloseDate: new Date(Date.now() + 21 * 86400000).toISOString(),
    assignedTo: 'sales@company.com',
    notes: 'Annual subscription. Evaluating vs competitor.',
    createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: 'deal_003',
    name: 'Global Finance - Compliance Module',
    contactId: 'contact_003',
    amount: 95000,
    currency: 'USD',
    stage: 'Discovery',
    probability: 25,
    expectedCloseDate: new Date(Date.now() + 60 * 86400000).toISOString(),
    assignedTo: 'enterprise@company.com',
    notes: 'Requires SOX compliance features. Security review pending.',
    createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
  },
  {
    id: 'deal_004',
    name: 'HealthSystems - Full Platform',
    contactId: 'contact_004',
    amount: 320000,
    currency: 'USD',
    stage: 'Closed Won',
    probability: 100,
    expectedCloseDate: new Date(Date.now() - 14 * 86400000).toISOString(),
    assignedTo: 'sales@company.com',
    notes: 'Won! Implementation begins next month. HIPAA BAA signed.',
    createdAt: new Date(Date.now() - 150 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 14 * 86400000).toISOString(),
  },
  {
    id: 'deal_005',
    name: 'Foster & Partners - Legal Ops',
    contactId: 'contact_007',
    amount: 67500,
    currency: 'USD',
    stage: 'Negotiation',
    probability: 80,
    expectedCloseDate: new Date(Date.now() + 14 * 86400000).toISOString(),
    assignedTo: 'enterprise@company.com',
    notes: 'Contract review by their legal team. Strong champion internally.',
    createdAt: new Date(Date.now() - 45 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
  },
];

const contactStore = new Map<string, CRMContact>(MOCK_CONTACTS.map((c) => [c.id, c]));
const dealStore = new Map<string, CRMDeal>(MOCK_DEALS.map((d) => [d.id, d]));

export class MockCRMAdapter implements CRMAdapter {
  async listContacts(filter?: ContactFilter): Promise<CRMContact[]> {
    let results = [...contactStore.values()];

    if (filter?.email) {
      results = results.filter((c) => c.email.toLowerCase().includes(filter.email!.toLowerCase()));
    }
    if (filter?.company) {
      results = results.filter((c) =>
        c.company?.toLowerCase().includes(filter.company!.toLowerCase()),
      );
    }
    if (filter?.stage) {
      results = results.filter((c) => c.stage === filter.stage);
    }
    if (filter?.assignedTo) {
      results = results.filter((c) => c.assignedTo === filter.assignedTo);
    }
    if (filter?.tags && filter.tags.length > 0) {
      results = results.filter((c) => filter.tags!.some((t) => c.tags.includes(t)));
    }

    return results.slice(0, filter?.limit ?? 20);
  }

  async getContact(id: string): Promise<CRMContact> {
    const contact = contactStore.get(id);
    if (!contact) throw new Error(`Contact '${id}' not found`);
    return contact;
  }

  async searchContacts(query: string): Promise<CRMContact[]> {
    const lower = query.toLowerCase();
    return [...contactStore.values()].filter(
      (c) =>
        c.firstName.toLowerCase().includes(lower) ||
        c.lastName.toLowerCase().includes(lower) ||
        c.email.toLowerCase().includes(lower) ||
        c.company?.toLowerCase().includes(lower),
    );
  }

  // Honesty fix (matches the email + calendar mocks): write operations
  // THROW instead of returning a success-shaped object with a `_notice`
  // field that nothing downstream actually inspects. Previously the LLM,
  // tool handler, and UI all saw what looked like a successful CRM
  // mutation, then relied on a `_notice` metadata field — which nothing
  // checked. The agent then reported "✓ updated contact" to the user.
  // Now these methods throw a typed error the tool layer translates to
  // a clear "CRM not connected" outcome in the cockpit.

  async updateContact(_id: string, _updates: Partial<CRMContact>): Promise<CRMContact> {
    throw new Error(
      'CRM not connected — contact update NOT saved. Connect HubSpot in Settings > Integrations.',
    );
  }

  async createNote(
    _contactId: string,
    _content: string,
    _authorId: string,
    _authorName: string,
  ): Promise<CRMNote> {
    throw new Error(
      'CRM not connected — note NOT saved. Connect HubSpot in Settings > Integrations.',
    );
  }

  async listDeals(contactId?: string): Promise<CRMDeal[]> {
    let results = [...dealStore.values()];
    if (contactId) {
      results = results.filter((d) => d.contactId === contactId);
    }
    return results;
  }

  async updateDealStage(_dealId: string, _stage: string, _notes?: string): Promise<CRMDeal> {
    throw new Error(
      'CRM not connected — deal stage NOT updated. Connect HubSpot in Settings > Integrations.',
    );
  }
}
