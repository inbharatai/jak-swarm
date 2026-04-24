import type { EmailAdapter, EmailMessage, EmailFilter, EmailDraft } from './email.interface.js';
// generateId removed — draftReply/createDraft/sendDraft throw, no IDs needed

// Seeded mock emails for different industry contexts
const MOCK_EMAILS_BY_INDUSTRY: Record<string, EmailMessage[]> = {
  healthcare: [
    {
      id: 'email_hc_001',
      from: 'intake@cityclinic.com',
      to: ['admin@cityclinic.com'],
      subject: 'New Patient Intake Form - Jane Doe',
      body: 'A new patient intake form has been submitted for processing. Patient reference: PTX-2024-0042. Please review and assign to the appropriate department.',
      date: new Date(Date.now() - 3600000).toISOString(),
      labels: ['INBOX', 'INTAKE'],
      attachments: [{ filename: 'intake_form.pdf', mimeType: 'application/pdf', size: 245000 }],
      snippet: 'A new patient intake form has been submitted...',
      threadId: 'thread_hc_001',
    },
    {
      id: 'email_hc_002',
      from: 'claims@insuranceco.com',
      to: ['billing@cityclinic.com'],
      subject: 'RE: Claim #CLM-8847 - Additional Documentation Required',
      body: 'Thank you for submitting claim CLM-8847. We require additional documentation before processing: 1) Physician notes from visit date, 2) Referral authorization if applicable. Please respond within 10 business days.',
      date: new Date(Date.now() - 86400000).toISOString(),
      labels: ['INBOX', 'CLAIMS'],
      attachments: [],
      snippet: 'We require additional documentation...',
      threadId: 'thread_hc_002',
    },
    {
      id: 'email_hc_003',
      from: 'scheduling@cityclinic.com',
      to: ['admin@cityclinic.com'],
      subject: 'Daily Schedule Report - Appointments for Tomorrow',
      body: 'Tomorrow\'s appointment schedule: 8:00 AM - 5 scheduled appointments. 3 patients pending confirmation. 2 follow-up calls required. Please review attached schedule.',
      date: new Date(Date.now() - 7200000).toISOString(),
      labels: ['INBOX', 'SCHEDULING'],
      attachments: [{ filename: 'schedule_report.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 32000 }],
      snippet: 'Tomorrow\'s appointment schedule...',
      threadId: 'thread_hc_003',
    },
    {
      id: 'email_hc_004',
      from: 'compliance@cityclinic.com',
      to: ['admin@cityclinic.com'],
      subject: 'HIPAA Training Reminder - Completion Required by EOQ',
      body: 'This is a reminder that annual HIPAA compliance training must be completed by end of quarter. Current completion rate: 78%. 12 staff members still outstanding. Please follow up.',
      date: new Date(Date.now() - 172800000).toISOString(),
      labels: ['INBOX', 'COMPLIANCE'],
      attachments: [],
      snippet: 'Annual HIPAA compliance training must be completed...',
      threadId: 'thread_hc_004',
    },
    {
      id: 'email_hc_005',
      from: 'pharmacy@cityclinic.com',
      to: ['admin@cityclinic.com'],
      subject: 'Low Inventory Alert - Critical Medications',
      body: 'Alert: The following medications are below minimum stock levels: Metformin 500mg (current: 45 units, min: 100), Lisinopril 10mg (current: 23 units, min: 75). Reorder required.',
      date: new Date(Date.now() - 14400000).toISOString(),
      labels: ['INBOX', 'INVENTORY', 'URGENT'],
      attachments: [],
      snippet: 'Critical medications below minimum stock levels...',
      threadId: 'thread_hc_005',
    },
  ],
  retail: [
    {
      id: 'email_rt_001',
      from: 'customer@email.com',
      to: ['support@retailstore.com'],
      subject: 'Return Request - Order #ORD-55821',
      body: 'I would like to return the blue hoodie I purchased last week (Order #ORD-55821). The size is too large. Please provide a return label. My order was $49.99.',
      date: new Date(Date.now() - 3600000).toISOString(),
      labels: ['INBOX', 'RETURNS'],
      attachments: [],
      snippet: 'I would like to return the blue hoodie...',
      threadId: 'thread_rt_001',
    },
    {
      id: 'email_rt_002',
      from: 'supplier@textiles.com',
      to: ['purchasing@retailstore.com'],
      subject: 'Spring Collection Inventory Available - Pre-Order Deadline',
      body: 'Spring 2025 collection is now available for pre-order. Pre-order deadline: March 15. Available SKUs attached. Standard lead time: 6-8 weeks. Volume discounts available for orders over 500 units.',
      date: new Date(Date.now() - 86400000).toISOString(),
      labels: ['INBOX', 'SUPPLIER'],
      attachments: [{ filename: 'spring_catalog.pdf', mimeType: 'application/pdf', size: 1200000 }],
      snippet: 'Spring 2025 collection is now available...',
      threadId: 'thread_rt_002',
    },
    {
      id: 'email_rt_003',
      from: 'inventory@retailstore.com',
      to: ['manager@retailstore.com'],
      subject: 'Weekly Inventory Report - Low Stock Alerts',
      body: 'This week\'s inventory summary: Total SKUs: 1,847. Low stock (< 20 units): 34 SKUs. Out of stock: 8 SKUs. Top sellers requiring reorder: SKU-1092, SKU-2341, SKU-0887.',
      date: new Date(Date.now() - 7200000).toISOString(),
      labels: ['INBOX', 'INVENTORY'],
      attachments: [],
      snippet: 'This week\'s inventory summary...',
      threadId: 'thread_rt_003',
    },
    {
      id: 'email_rt_004',
      from: 'customer2@email.com',
      to: ['support@retailstore.com'],
      subject: 'Complaint - Wrong Item Shipped',
      body: 'I am very disappointed. I ordered a red dress (SKU-4421) but received a green one. This is the second time this has happened. I need this resolved immediately or I will leave a negative review.',
      date: new Date(Date.now() - 10800000).toISOString(),
      labels: ['INBOX', 'COMPLAINT', 'URGENT'],
      attachments: [],
      snippet: 'I am very disappointed. I ordered a red dress...',
      threadId: 'thread_rt_004',
    },
    {
      id: 'email_rt_005',
      from: 'marketing@retailstore.com',
      to: ['manager@retailstore.com'],
      subject: 'Black Friday Campaign Performance Report',
      body: 'Black Friday results: Total revenue: $284,500 (up 23% YoY). Orders processed: 3,421. Average order value: $83.20. Top product: Winter Jacket SKU-7799 (452 units). Cart abandonment rate: 34%.',
      date: new Date(Date.now() - 172800000).toISOString(),
      labels: ['INBOX', 'MARKETING', 'REPORTS'],
      attachments: [{ filename: 'bf_report.pdf', mimeType: 'application/pdf', size: 456000 }],
      snippet: 'Black Friday results: Total revenue...',
      threadId: 'thread_rt_005',
    },
  ],
  default: [
    {
      id: 'email_gen_001',
      from: 'colleague@company.com',
      to: ['user@company.com'],
      subject: 'Action Required: Review Q4 Budget Proposal',
      body: 'Hi, please review the attached Q4 budget proposal and provide your feedback by end of week. Key points: Total budget request $1.2M, IT infrastructure 40%, headcount 35%, ops 25%.',
      date: new Date(Date.now() - 3600000).toISOString(),
      labels: ['INBOX'],
      attachments: [{ filename: 'q4_budget.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 78000 }],
      snippet: 'Please review the attached Q4 budget proposal...',
      threadId: 'thread_gen_001',
    },
    {
      id: 'email_gen_002',
      from: 'it@company.com',
      to: ['user@company.com'],
      subject: 'Scheduled Maintenance: Systems Unavailable Saturday 2-4 AM',
      body: 'Planned maintenance window: Saturday, April 5th, 2:00 AM - 4:00 AM EST. Affected systems: ERP, CRM, Email (partial). Please save all work before maintenance window begins.',
      date: new Date(Date.now() - 86400000).toISOString(),
      labels: ['INBOX', 'IT'],
      attachments: [],
      snippet: 'Planned maintenance window: Saturday...',
      threadId: 'thread_gen_002',
    },
    {
      id: 'email_gen_003',
      from: 'hr@company.com',
      to: ['user@company.com'],
      subject: 'Open Enrollment Reminder - Benefits Selection Deadline',
      body: 'Open enrollment for 2025 benefits ends Friday. Please log in to the benefits portal to make your selections. Changes take effect January 1, 2025. Contact HR with questions.',
      date: new Date(Date.now() - 7200000).toISOString(),
      labels: ['INBOX', 'HR'],
      attachments: [],
      snippet: 'Open enrollment for 2025 benefits ends Friday...',
      threadId: 'thread_gen_003',
    },
    {
      id: 'email_gen_004',
      from: 'manager@company.com',
      to: ['user@company.com'],
      subject: 'Weekly Standup Notes - Action Items',
      body: 'From today\'s standup: 1) Deploy hotfix by Thursday - Owner: You, 2) Update documentation - Owner: Team, 3) Client demo prep - Owner: Sales + You, 4) Performance review prep - Due next week.',
      date: new Date(Date.now() - 10800000).toISOString(),
      labels: ['INBOX'],
      attachments: [],
      snippet: 'From today\'s standup: 1) Deploy hotfix by Thursday...',
      threadId: 'thread_gen_004',
    },
    {
      id: 'email_gen_005',
      from: 'noreply@service.com',
      to: ['user@company.com'],
      subject: 'Your monthly invoice is ready',
      body: 'Your invoice for March 2025 is now available. Amount due: $2,450.00. Due date: April 15, 2025. Download your invoice from the billing portal or view it attached.',
      date: new Date(Date.now() - 14400000).toISOString(),
      labels: ['INBOX', 'BILLING'],
      attachments: [{ filename: 'invoice_march2025.pdf', mimeType: 'application/pdf', size: 123000 }],
      snippet: 'Your invoice for March 2025 is now available...',
      threadId: 'thread_gen_005',
    },
  ],
};

const mockDrafts = new Map<string, EmailDraft>();

export class MockEmailAdapter implements EmailAdapter {
  private readonly emails: EmailMessage[];

  constructor(industry = 'default') {
    this.emails = [
      ...(MOCK_EMAILS_BY_INDUSTRY[industry] ?? []),
      ...(MOCK_EMAILS_BY_INDUSTRY['default'] ?? []),
    ];
  }

  async listMessages(filter: EmailFilter): Promise<EmailMessage[]> {
    let results = [...this.emails];

    if (filter.from) {
      results = results.filter((e) =>
        e.from.toLowerCase().includes(filter.from!.toLowerCase()),
      );
    }
    if (filter.subject) {
      results = results.filter((e) =>
        e.subject.toLowerCase().includes(filter.subject!.toLowerCase()),
      );
    }
    if (filter.labels && filter.labels.length > 0) {
      results = results.filter((e) =>
        filter.labels!.some((l) => e.labels.includes(l.toUpperCase())),
      );
    }
    if (filter.after) {
      const afterDate = new Date(filter.after);
      results = results.filter((e) => new Date(e.date) >= afterDate);
    }
    if (filter.before) {
      const beforeDate = new Date(filter.before);
      results = results.filter((e) => new Date(e.date) <= beforeDate);
    }

    return results.slice(0, filter.limit ?? 10).map((e) => ({ ...e, _mock: true } as EmailMessage));
  }

  async getMessage(id: string): Promise<EmailMessage> {
    const email = this.emails.find((e) => e.id === id);
    if (!email) {
      throw new Error(`Email '${id}' not found`);
    }
    return { ...email, _mock: true } as EmailMessage;
  }

  // Stage 1 honesty fix: all write operations THROW instead of silently
  // embedding `_notice` metadata in success-shaped responses. The mock
  // adapter previously let callers receive what looked like a successful
  // draft/send, then relied on them inspecting the `_notice` field —
  // which nothing downstream (tool handlers, LLM, UI) actually did.
  // Now these methods throw a typed error the tool layer translates to
  // a clear "Email not connected — please connect Gmail" message in chat.

  async draftReply(_messageId: string, _body: string): Promise<EmailDraft> {
    throw new Error(
      'Email integration not connected — cannot draft reply. Connect Gmail in Settings > Integrations.',
    );
  }

  async createDraft(_to: string[], _subject: string, _body: string, _cc?: string[]): Promise<EmailDraft> {
    throw new Error(
      'Email integration not connected — cannot create draft. Connect Gmail in Settings > Integrations.',
    );
  }

  async sendDraft(_draftId: string): Promise<void> {
    throw new Error(
      'Email integration not connected — email NOT sent. Connect Gmail in Settings > Integrations.',
    );
  }

  async searchMessages(query: string): Promise<EmailMessage[]> {
    const lower = query.toLowerCase();
    return this.emails.filter(
      (e) =>
        e.subject.toLowerCase().includes(lower) ||
        e.body.toLowerCase().includes(lower) ||
        e.from.toLowerCase().includes(lower),
    );
  }

  async updateDraft(draftId: string, updates: Partial<EmailDraft>): Promise<EmailDraft> {
    const existing = mockDrafts.get(draftId);
    if (!existing) throw new Error(`Draft '${draftId}' not found`);
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    mockDrafts.set(draftId, updated);
    return updated;
  }

  async deleteDraft(draftId: string): Promise<void> {
    mockDrafts.delete(draftId);
  }
}
