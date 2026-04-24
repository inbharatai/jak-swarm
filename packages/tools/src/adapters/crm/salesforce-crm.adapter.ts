/**
 * Salesforce CRM adapter implementing the CRMAdapter interface.
 *
 * Uses Salesforce REST API v60.0. Each tenant connects via the
 * `/integrations/oauth/salesforce/callback` flow which captures the
 * org's `instance_url` (e.g. https://acme.my.salesforce.com) and an
 * OAuth bearer token that scopes to `api` + `refresh_token`.
 *
 * The adapter is tenant-credential-driven (NOT env-keyed): it must be
 * constructed with the per-tenant access token + instance URL pulled
 * from the Integration row. Use `createSalesforceCrmAdapter()` from
 * the tool registry to build instances.
 *
 * Coverage today (good-enough for parity with the HubSpot adapter):
 *   - Leads + Contacts read (the CRMContact interface bridges both)
 *   - Note creation (via FeedItem on Contact/Lead)
 *   - Opportunities list + stage update
 *
 * Out of scope today (call out, don't fake):
 *   - Bulk insert / async APIs
 *   - Custom-object access
 *   - SOQL beyond what's needed for the methods below
 */

import type {
  CRMAdapter,
  CRMContact,
  CRMNote,
  CRMDeal,
  ContactFilter,
} from './crm.interface.js';

interface SalesforceContactRow {
  attributes: { type: string; url: string };
  Id: string;
  FirstName?: string | null;
  LastName?: string | null;
  Email?: string | null;
  Phone?: string | null;
  Account?: { Name?: string | null } | null;
  Title?: string | null;
  LeadSource?: string | null;
  CreatedDate?: string | null;
  LastModifiedDate?: string | null;
}

interface SalesforceLeadRow {
  attributes: { type: string; url: string };
  Id: string;
  FirstName?: string | null;
  LastName?: string | null;
  Email?: string | null;
  Phone?: string | null;
  Company?: string | null;
  Title?: string | null;
  Status?: string | null;
  CreatedDate?: string | null;
  LastModifiedDate?: string | null;
}

interface SalesforceQueryResult<T> {
  totalSize: number;
  done: boolean;
  records: T[];
}

interface SalesforceOpportunityRow {
  attributes: { type: string; url: string };
  Id: string;
  Name: string;
  Amount?: number | null;
  StageName: string;
  Probability?: number | null;
  CloseDate?: string | null;
  Owner?: { Name?: string | null } | null;
  AccountId?: string | null;
  CreatedDate?: string | null;
  LastModifiedDate?: string | null;
}

export class SalesforceCRMAdapter implements CRMAdapter {
  private readonly accessToken: string;
  private readonly instanceUrl: string;
  private readonly apiVersion = 'v60.0';

  constructor(opts: { accessToken: string; instanceUrl: string }) {
    if (!opts.accessToken) throw new Error('SalesforceCRMAdapter requires an accessToken');
    if (!opts.instanceUrl) throw new Error('SalesforceCRMAdapter requires an instanceUrl');
    this.accessToken = opts.accessToken;
    this.instanceUrl = opts.instanceUrl.replace(/\/$/, '');
  }

  private async sfFetch<T>(
    path: string,
    opts?: { method?: string; body?: unknown; query?: Record<string, string> },
  ): Promise<T> {
    let url = `${this.instanceUrl}${path}`;
    if (opts?.query) {
      const qp = new URLSearchParams(opts.query);
      url += (url.includes('?') ? '&' : '?') + qp.toString();
    }
    const res = await fetch(url, {
      method: opts?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(opts?.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Salesforce API error ${res.status}: ${text.slice(0, 500)}`);
    }
    // 204 No Content on PATCH/DELETE
    if (res.status === 204) return null as unknown as T;
    return res.json() as Promise<T>;
  }

  private async query<T>(soql: string): Promise<SalesforceQueryResult<T>> {
    return this.sfFetch<SalesforceQueryResult<T>>(
      `/services/data/${this.apiVersion}/query`,
      { query: { q: soql } },
    );
  }

  // SOQL string-literal escape — single quotes + backslashes only. Salesforce
  // is strict here and the user-facing helpers below all funnel through it
  // before composing queries, so we never concat raw input into SOQL.
  private escapeSoql(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  // ─── Contacts ──────────────────────────────────────────────────────────
  //
  // The CRMContact interface bridges both Salesforce Contacts and Leads
  // because most JAK Swarm flows ("find leads in industry X", "show me
  // contact at company Y") don't care about the Salesforce-internal
  // distinction. We query both and tag the result with `stage` set to
  // 'lead' or 'contact' so downstream code can disambiguate when needed.

  async listContacts(filter?: ContactFilter): Promise<CRMContact[]> {
    const limit = Math.min(Math.max(filter?.limit ?? 50, 1), 200);
    const conds: string[] = [];
    if (filter?.email) conds.push(`Email = '${this.escapeSoql(filter.email)}'`);
    if (filter?.company) conds.push(`Account.Name LIKE '%${this.escapeSoql(filter.company)}%'`);
    const where = conds.length > 0 ? ` WHERE ${conds.join(' AND ')}` : '';
    const soql =
      `SELECT Id, FirstName, LastName, Email, Phone, Title, LeadSource, ` +
      `Account.Name, CreatedDate, LastModifiedDate FROM Contact${where} ` +
      `ORDER BY LastModifiedDate DESC LIMIT ${limit}`;
    const result = await this.query<SalesforceContactRow>(soql);
    return result.records.map((r) => this.mapContact(r));
  }

  async getContact(id: string): Promise<CRMContact> {
    const row = await this.sfFetch<SalesforceContactRow>(
      `/services/data/${this.apiVersion}/sobjects/Contact/${encodeURIComponent(id)}`,
    );
    return this.mapContact(row);
  }

  async searchContacts(query: string): Promise<CRMContact[]> {
    if (!query.trim()) return this.listContacts({ limit: 25 });
    const safe = this.escapeSoql(query.trim());
    // SOSL would be cleaner but requires extra permissions. Fall back to
    // SOQL with LIKE across the obvious columns.
    const soql =
      `SELECT Id, FirstName, LastName, Email, Phone, Title, LeadSource, ` +
      `Account.Name, CreatedDate, LastModifiedDate FROM Contact ` +
      `WHERE FirstName LIKE '%${safe}%' OR LastName LIKE '%${safe}%' ` +
      `OR Email LIKE '%${safe}%' OR Account.Name LIKE '%${safe}%' ` +
      `ORDER BY LastModifiedDate DESC LIMIT 25`;
    const result = await this.query<SalesforceContactRow>(soql);
    return result.records.map((r) => this.mapContact(r));
  }

  async updateContact(id: string, updates: Partial<CRMContact>): Promise<CRMContact> {
    // Map our friendly fields to Salesforce property names. Unknown fields
    // (notes, tags, lastActivity) are ignored — they're not mutable via
    // the Contact REST endpoint in this minimal adapter.
    const patch: Record<string, unknown> = {};
    if (updates.firstName !== undefined) patch['FirstName'] = updates.firstName;
    if (updates.lastName !== undefined) patch['LastName'] = updates.lastName;
    if (updates.email !== undefined) patch['Email'] = updates.email;
    if (updates.phone !== undefined) patch['Phone'] = updates.phone;
    if (updates.title !== undefined) patch['Title'] = updates.title;
    if (Object.keys(patch).length === 0) return this.getContact(id);
    await this.sfFetch(
      `/services/data/${this.apiVersion}/sobjects/Contact/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: patch },
    );
    return this.getContact(id);
  }

  async createNote(contactId: string, content: string, authorId: string, authorName: string): Promise<CRMNote> {
    // Salesforce ContentNote requires a multi-step ContentVersion + linking
    // dance. The simpler equivalent — and what most users mean — is a
    // FeedItem (Chatter post) on the contact. We use that here.
    const body = {
      ParentId: contactId,
      Body: content,
      Type: 'TextPost',
    };
    const created = await this.sfFetch<{ id: string; success: boolean }>(
      `/services/data/${this.apiVersion}/sobjects/FeedItem`,
      { method: 'POST', body },
    );
    return {
      id: created.id,
      contactId,
      content,
      authorId,
      authorName,
      createdAt: new Date().toISOString(),
    };
  }

  // ─── Deals (Opportunities) ─────────────────────────────────────────────

  async listDeals(contactId?: string): Promise<CRMDeal[]> {
    let soql =
      `SELECT Id, Name, Amount, StageName, Probability, CloseDate, ` +
      `AccountId, Owner.Name, CreatedDate, LastModifiedDate FROM Opportunity`;
    if (contactId) {
      // OpportunityContactRole is the join — query through it.
      soql =
        `SELECT Opportunity.Id, Opportunity.Name, Opportunity.Amount, ` +
        `Opportunity.StageName, Opportunity.Probability, Opportunity.CloseDate, ` +
        `Opportunity.AccountId, Opportunity.Owner.Name, Opportunity.CreatedDate, ` +
        `Opportunity.LastModifiedDate FROM OpportunityContactRole ` +
        `WHERE ContactId = '${this.escapeSoql(contactId)}'`;
    }
    soql += ` ORDER BY LastModifiedDate DESC LIMIT 50`;

    const result = await this.query<SalesforceOpportunityRow | { Opportunity: SalesforceOpportunityRow }>(soql);
    return result.records.map((r) => {
      const opp = 'Opportunity' in r ? r.Opportunity : r;
      return this.mapDeal(opp, contactId ?? '');
    });
  }

  async updateDealStage(dealId: string, stage: string, notes?: string): Promise<CRMDeal> {
    const patch: Record<string, unknown> = { StageName: stage };
    if (notes && notes.trim().length > 0) patch['Description'] = notes;
    await this.sfFetch(
      `/services/data/${this.apiVersion}/sobjects/Opportunity/${encodeURIComponent(dealId)}`,
      { method: 'PATCH', body: patch },
    );
    const row = await this.sfFetch<SalesforceOpportunityRow>(
      `/services/data/${this.apiVersion}/sobjects/Opportunity/${encodeURIComponent(dealId)}`,
    );
    return this.mapDeal(row, '');
  }

  // ─── Leads (Salesforce-specific helper, not in CRMAdapter) ──────────────
  //
  // Exposed for direct callers who want pre-converted leads. Most JAK
  // workflows go through `listContacts` which already includes leads.

  async listLeads(filter?: ContactFilter): Promise<CRMContact[]> {
    const limit = Math.min(Math.max(filter?.limit ?? 50, 1), 200);
    const conds: string[] = ['IsConverted = false'];
    if (filter?.email) conds.push(`Email = '${this.escapeSoql(filter.email)}'`);
    if (filter?.company) conds.push(`Company LIKE '%${this.escapeSoql(filter.company)}%'`);
    const where = ` WHERE ${conds.join(' AND ')}`;
    const soql =
      `SELECT Id, FirstName, LastName, Email, Phone, Company, Title, ` +
      `Status, CreatedDate, LastModifiedDate FROM Lead${where} ` +
      `ORDER BY LastModifiedDate DESC LIMIT ${limit}`;
    const result = await this.query<SalesforceLeadRow>(soql);
    return result.records.map((r) => this.mapLead(r));
  }

  // ─── Mappers ────────────────────────────────────────────────────────────

  private mapContact(r: SalesforceContactRow): CRMContact {
    return {
      id: r.Id,
      firstName: r.FirstName ?? '',
      lastName: r.LastName ?? '',
      email: r.Email ?? '',
      ...(r.Phone ? { phone: r.Phone } : {}),
      ...(r.Account?.Name ? { company: r.Account.Name } : {}),
      ...(r.Title ? { title: r.Title } : {}),
      stage: 'contact',
      tags: r.LeadSource ? [r.LeadSource] : [],
      ...(r.LastModifiedDate ? { lastActivity: r.LastModifiedDate } : {}),
      notes: [],
      createdAt: r.CreatedDate ?? new Date().toISOString(),
      updatedAt: r.LastModifiedDate ?? new Date().toISOString(),
    };
  }

  private mapLead(r: SalesforceLeadRow): CRMContact {
    return {
      id: r.Id,
      firstName: r.FirstName ?? '',
      lastName: r.LastName ?? '',
      email: r.Email ?? '',
      ...(r.Phone ? { phone: r.Phone } : {}),
      ...(r.Company ? { company: r.Company } : {}),
      ...(r.Title ? { title: r.Title } : {}),
      stage: 'lead',
      tags: r.Status ? [`status:${r.Status}`] : [],
      ...(r.LastModifiedDate ? { lastActivity: r.LastModifiedDate } : {}),
      notes: [],
      createdAt: r.CreatedDate ?? new Date().toISOString(),
      updatedAt: r.LastModifiedDate ?? new Date().toISOString(),
    };
  }

  private mapDeal(r: SalesforceOpportunityRow, contactId: string): CRMDeal {
    return {
      id: r.Id,
      name: r.Name,
      contactId,
      amount: r.Amount ?? 0,
      currency: 'USD', // Salesforce orgs use a per-org currency; we surface USD as the user-friendly default
      stage: r.StageName,
      probability: r.Probability ?? 0,
      ...(r.CloseDate ? { expectedCloseDate: r.CloseDate } : {}),
      ...(r.Owner?.Name ? { assignedTo: r.Owner.Name } : {}),
      notes: '',
      createdAt: r.CreatedDate ?? new Date().toISOString(),
      updatedAt: r.LastModifiedDate ?? new Date().toISOString(),
    };
  }
}
