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
export interface CrmPrisma {
  crmContact: {
    findMany: (args: any) => Promise<any[]>;
    // findFirstOrThrow (not findUniqueOrThrow) because tenant isolation pairs
    // `id` with `tenantId`, and `[tenantId, id]` is NOT a @@unique — only
    // `[tenantId, email]` is. findUniqueOrThrow cannot accept a non-unique
    // composite, so every record-specific read goes through findFirstOrThrow
    // with `where: { id, tenantId }`.
    findFirstOrThrow: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
  };
  crmNote: {
    create: (args: any) => Promise<any>;
  };
  crmDeal: {
    findMany: (args: any) => Promise<any[]>;
    findFirstOrThrow: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
  };
  // Used by createNote to verify the parent contact's tenant AND attach the
  // note + touch lastActivity atomically — so a cross-tenant contactId can
  // never get a note pinned to it, even under concurrency.
  $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>;
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
    // Tenant-scoped read: a cross-tenant id matches 0 rows → throws
    // `P2025` (findFirstOrThrow found no record). The error is identical to
    // the one raised for a truly-absent id, so a caller cannot infer whether
    // the record exists in another tenant (no existence oracle).
    const row = await this.db.crmContact.findFirstOrThrow({
      where: { id, tenantId: this.tenantId },
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

    // Tenant-scoped mutation: updateMany with `where: { id, tenantId }` so a
    // cross-tenant id matches 0 rows (count 0) instead of silently mutating
    // another tenant's record. We then re-read through the same tenant-scoped
    // filter to return the updated row — never a bare `update({ where: { id } })`,
    // which would ignore the tenant boundary.
    const result = await this.db.crmContact.updateMany({
      where: { id, tenantId: this.tenantId },
      data,
    });
    if (result.count === 0) {
      throw new Error(`CRM contact ${id} not found for tenant ${this.tenantId}`);
    }
    const row = await this.db.crmContact.findFirstOrThrow({
      where: { id, tenantId: this.tenantId },
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
    // CrmNote has NO tenantId column — its tenant is inherited from the parent
    // CrmContact. So before attaching a note we MUST prove the parent contact
    // belongs to THIS tenant, and do it in the SAME transaction as the note
    // create + lastActivity touch. Without this, a cross-tenant contactId
    // supplied by an untrusted caller would get a note pinned to another
    // tenant's contact (an IDOR on the note relation).
    return this.db.$transaction(async (tx) => {
      await tx.crmContact.findFirstOrThrow({
        where: { id: contactId, tenantId: this.tenantId },
      });
      const row = await tx.crmNote.create({
        data: { contactId, content, authorId, authorName },
      });
      await tx.crmContact.update({
        where: { id: contactId },
        data: { lastActivity: new Date() },
      });
      return mapNote(row);
    });
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

    // Tenant-scoped mutation: CrmDeal carries its own tenantId, so updateMany
    // with `where: { id, tenantId }` confines the write to this tenant. A
    // cross-tenant dealId matches 0 rows → throw, no silent cross-tenant edit.
    const result = await this.db.crmDeal.updateMany({
      where: { id: dealId, tenantId: this.tenantId },
      data,
    });
    if (result.count === 0) {
      throw new Error(`CRM deal ${dealId} not found for tenant ${this.tenantId}`);
    }
    const row = await this.db.crmDeal.findFirstOrThrow({
      where: { id: dealId, tenantId: this.tenantId },
    });
    return mapDeal(row);
  }
}
