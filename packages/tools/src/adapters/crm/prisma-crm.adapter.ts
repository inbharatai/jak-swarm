/**
 * Prisma-backed CRM adapter.
 *
 * This is a REAL adapter — all data is stored in and retrieved from
 * the PostgreSQL database via Prisma.  No mock data, no fakes.
 */

import type {
  CRMAdapter,
  CRMContact,
  CRMNote,
  CRMDeal,
  ContactFilter,
} from './crm.interface.js';

/**
 * Minimal Prisma client subset required by the CRM adapter.
 * Avoids importing the full PrismaClient type (which lives in @jak-swarm/db).
 */
interface CrmPrisma {
  crmContact: {
    findMany: (args: any) => Promise<any[]>;
    findUniqueOrThrow: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
  crmNote: {
    create: (args: any) => Promise<any>;
  };
  crmDeal: {
    findMany: (args: any) => Promise<any[]>;
    update: (args: any) => Promise<any>;
  };
}

function mapContact(row: any): CRMContact {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone ?? undefined,
    company: row.company ?? undefined,
    title: row.title ?? undefined,
    stage: row.stage,
    tags: row.tags ?? [],
    assignedTo: row.assignedTo ?? undefined,
    lastActivity: row.lastActivity?.toISOString() ?? undefined,
    notes: (row.notes ?? []).map(mapNote),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapNote(row: any): CRMNote {
  return {
    id: row.id,
    contactId: row.contactId,
    content: row.content,
    authorId: row.authorId,
    authorName: row.authorName,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapDeal(row: any): CRMDeal {
  return {
    id: row.id,
    name: row.name,
    contactId: row.contactId,
    amount: row.amount,
    currency: row.currency,
    stage: row.stage,
    probability: row.probability,
    expectedCloseDate: row.expectedCloseDate?.toISOString() ?? undefined,
    assignedTo: row.assignedTo ?? undefined,
    notes: row.notes ?? '',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class PrismaCRMAdapter implements CRMAdapter {
  constructor(
    private readonly db: CrmPrisma,
    private readonly tenantId: string,
  ) {}

  async listContacts(filter?: ContactFilter): Promise<CRMContact[]> {
    const where: any = { tenantId: this.tenantId };
    if (filter?.email) where.email = filter.email;
    if (filter?.company) where.company = { contains: filter.company, mode: 'insensitive' };
    if (filter?.stage) where.stage = filter.stage;
    if (filter?.assignedTo) where.assignedTo = filter.assignedTo;
    if (filter?.tags?.length) where.tags = { hasSome: filter.tags };

    const rows = await this.db.crmContact.findMany({
      where,
      include: { notes: true },
      take: filter?.limit ?? 50,
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(mapContact);
  }

  async getContact(id: string): Promise<CRMContact> {
    const row = await this.db.crmContact.findUniqueOrThrow({
      where: { id },
      include: { notes: true },
    });
    return mapContact(row);
  }

  async searchContacts(query: string): Promise<CRMContact[]> {
    const rows = await this.db.crmContact.findMany({
      where: {
        tenantId: this.tenantId,
        OR: [
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { company: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: { notes: true },
      take: 20,
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(mapContact);
  }

  async updateContact(id: string, updates: Partial<CRMContact>): Promise<CRMContact> {
    const data: any = {};
    if (updates.firstName !== undefined) data.firstName = updates.firstName;
    if (updates.lastName !== undefined) data.lastName = updates.lastName;
    if (updates.email !== undefined) data.email = updates.email;
    if (updates.phone !== undefined) data.phone = updates.phone;
    if (updates.company !== undefined) data.company = updates.company;
    if (updates.title !== undefined) data.title = updates.title;
    if (updates.stage !== undefined) data.stage = updates.stage;
    if (updates.tags !== undefined) data.tags = updates.tags;
    if (updates.assignedTo !== undefined) data.assignedTo = updates.assignedTo;
    data.lastActivity = new Date();

    const row = await this.db.crmContact.update({
      where: { id },
      data,
      include: { notes: true },
    });
    return mapContact(row);
  }

  async createNote(
    contactId: string,
    content: string,
    authorId: string,
    authorName: string,
  ): Promise<CRMNote> {
    const row = await this.db.crmNote.create({
      data: { contactId, content, authorId, authorName },
    });
    // Touch the contact's lastActivity
    await this.db.crmContact.update({
      where: { id: contactId },
      data: { lastActivity: new Date() },
    });
    return mapNote(row);
  }

  async listDeals(contactId?: string): Promise<CRMDeal[]> {
    const where: any = { tenantId: this.tenantId };
    if (contactId) where.contactId = contactId;

    const rows = await this.db.crmDeal.findMany({
      where,
      take: 50,
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(mapDeal);
  }

  async updateDealStage(dealId: string, stage: string, notes?: string): Promise<CRMDeal> {
    const data: any = { stage };
    if (notes !== undefined) data.notes = notes;

    const row = await this.db.crmDeal.update({
      where: { id: dealId },
      data,
    });
    return mapDeal(row);
  }
}
