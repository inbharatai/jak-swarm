/**
 * HubSpot CRM adapter implementing the CRMAdapter interface.
 * Uses HubSpot REST API v3. Requires HUBSPOT_API_KEY env var.
 */

import type {
  CRMAdapter,
  CRMContact,
  CRMNote,
  CRMDeal,
  ContactFilter,
} from './crm.interface.js';

const HUBSPOT_BASE = 'https://api.hubapi.com';

export class HubSpotCRMAdapter implements CRMAdapter {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async hubspotFetch<T>(
    path: string,
    opts?: { method?: string; body?: unknown },
  ): Promise<T> {
    const url = `${HUBSPOT_BASE}${path}`;
    const response = await fetch(url, {
      method: opts?.method ?? 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      ...(opts?.body ? { body: JSON.stringify(opts.body) } : {}),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`HubSpot API error ${response.status}: ${err}`);
    }

    return response.json() as Promise<T>;
  }

  // ─── Contacts ──────────────────────────────────────────────────────────

  async listContacts(filter?: ContactFilter): Promise<CRMContact[]> {
    const properties = 'firstname,lastname,email,phone,company,jobtitle,lifecyclestage,hs_lead_status,createdate,lastmodifieddate';

    let path = `/crm/v3/objects/contacts?limit=50&properties=${properties}`;

    // HubSpot search API for filtered queries
    if (filter?.email || filter?.company || filter?.stage) {
      const filters: Array<{ propertyName: string; operator: string; value: string }> = [];
      if (filter.email) filters.push({ propertyName: 'email', operator: 'EQ', value: filter.email });
      if (filter.company) filters.push({ propertyName: 'company', operator: 'CONTAINS_TOKEN', value: filter.company });
      if (filter.stage) filters.push({ propertyName: 'lifecyclestage', operator: 'EQ', value: this.mapStageToHubSpot(filter.stage) });

      const result = await this.hubspotFetch<HubSpotSearchResult>('/crm/v3/objects/contacts/search', {
        method: 'POST',
        body: {
          filterGroups: [{ filters }],
          properties: properties.split(','),
          limit: 50,
        },
      });

      return result.results.map((r) => this.mapContact(r));
    }

    const result = await this.hubspotFetch<HubSpotListResult>(path);
    return result.results.map((r) => this.mapContact(r));
  }

  async getContact(id: string): Promise<CRMContact> {
    const properties = 'firstname,lastname,email,phone,company,jobtitle,lifecyclestage,hs_lead_status,createdate,lastmodifieddate';
    const result = await this.hubspotFetch<HubSpotObject>(
      `/crm/v3/objects/contacts/${id}?properties=${properties}&associations=notes`,
    );
    return this.mapContact(result);
  }

  async searchContacts(query: string): Promise<CRMContact[]> {
    const result = await this.hubspotFetch<HubSpotSearchResult>('/crm/v3/objects/contacts/search', {
      method: 'POST',
      body: {
        query,
        properties: ['firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle', 'lifecyclestage'],
        limit: 20,
      },
    });
    return result.results.map((r) => this.mapContact(r));
  }

  async updateContact(id: string, updates: Partial<CRMContact>): Promise<CRMContact> {
    const properties: Record<string, string> = {};
    if (updates.firstName) properties['firstname'] = updates.firstName;
    if (updates.lastName) properties['lastname'] = updates.lastName;
    if (updates.email) properties['email'] = updates.email;
    if (updates.phone) properties['phone'] = updates.phone;
    if (updates.company) properties['company'] = updates.company;
    if (updates.title) properties['jobtitle'] = updates.title;
    if (updates.stage) properties['lifecyclestage'] = this.mapStageToHubSpot(updates.stage);

    const result = await this.hubspotFetch<HubSpotObject>(`/crm/v3/objects/contacts/${id}`, {
      method: 'PATCH',
      body: { properties },
    });

    return this.mapContact(result);
  }

  // ─── Notes ─────────────────────────────────────────────────────────────

  async createNote(
    contactId: string,
    content: string,
    authorId: string,
    authorName: string,
  ): Promise<CRMNote> {
    // Create the note
    const note = await this.hubspotFetch<HubSpotObject>('/crm/v3/objects/notes', {
      method: 'POST',
      body: {
        properties: {
          hs_note_body: content,
          hs_timestamp: new Date().toISOString(),
        },
      },
    });

    // Associate note with contact
    await this.hubspotFetch<unknown>(
      `/crm/v3/objects/notes/${note.id}/associations/contacts/${contactId}/note_to_contact`,
      { method: 'PUT' },
    );

    return {
      id: note.id,
      contactId,
      content,
      authorId,
      authorName,
      createdAt: new Date().toISOString(),
    };
  }

  // ─── Deals ─────────────────────────────────────────────────────────────

  async listDeals(contactId?: string): Promise<CRMDeal[]> {
    if (contactId) {
      // Get deals associated with contact
      const result = await this.hubspotFetch<HubSpotListResult>(
        `/crm/v3/objects/contacts/${contactId}/associations/deals`,
      );
      const dealIds = result.results.map((r) => r.id);
      const deals: CRMDeal[] = [];
      for (const dealId of dealIds.slice(0, 20)) {
        const deal = await this.hubspotFetch<HubSpotObject>(
          `/crm/v3/objects/deals/${dealId}?properties=dealname,amount,dealstage,closedate,pipeline`,
        );
        deals.push(this.mapDeal(deal));
      }
      return deals;
    }

    const result = await this.hubspotFetch<HubSpotListResult>(
      '/crm/v3/objects/deals?limit=50&properties=dealname,amount,dealstage,closedate,pipeline',
    );
    return result.results.map((r) => this.mapDeal(r));
  }

  async updateDealStage(dealId: string, stage: string, notes?: string): Promise<CRMDeal> {
    const properties: Record<string, string> = {
      dealstage: this.mapDealStageToHubSpot(stage),
    };
    if (notes) properties['description'] = notes;

    const result = await this.hubspotFetch<HubSpotObject>(`/crm/v3/objects/deals/${dealId}`, {
      method: 'PATCH',
      body: { properties },
    });

    return this.mapDeal(result);
  }

  // ─── Mappers ───────────────────────────────────────────────────────────

  private mapContact(obj: HubSpotObject): CRMContact {
    const p = obj.properties;
    return {
      id: obj.id,
      firstName: p['firstname'] ?? '',
      lastName: p['lastname'] ?? '',
      email: p['email'] ?? '',
      phone: p['phone'] ?? undefined,
      company: p['company'] ?? undefined,
      title: p['jobtitle'] ?? undefined,
      stage: this.mapStageFromHubSpot(p['lifecyclestage'] ?? ''),
      tags: p['hs_lead_status'] ? [p['hs_lead_status']] : [],
      assignedTo: undefined,
      notes: [],
      createdAt: p['createdate'] ?? new Date().toISOString(),
      updatedAt: p['lastmodifieddate'] ?? new Date().toISOString(),
    };
  }

  private mapDeal(obj: HubSpotObject): CRMDeal {
    const p = obj.properties;
    return {
      id: obj.id,
      name: p['dealname'] ?? 'Untitled Deal',
      contactId: '', // Would need association lookup
      amount: p['amount'] ? Number(p['amount']) : 0,
      currency: 'USD',
      stage: this.mapDealStageFromHubSpot(p['dealstage'] ?? ''),
      probability: this.stageProbability(p['dealstage'] ?? ''),
      expectedCloseDate: p['closedate'] ?? undefined,
      assignedTo: undefined,
      notes: '',
      createdAt: obj.createdAt ?? new Date().toISOString(),
      updatedAt: obj.updatedAt ?? new Date().toISOString(),
    };
  }

  private mapStageToHubSpot(stage: string): string {
    const map: Record<string, string> = {
      'LEAD': 'lead',
      'QUALIFIED': 'marketingqualifiedlead',
      'OPPORTUNITY': 'opportunity',
      'CUSTOMER': 'customer',
      'CHURNED': 'other',
    };
    return map[stage] ?? stage.toLowerCase();
  }

  private mapStageFromHubSpot(hsStage: string): string {
    const map: Record<string, string> = {
      'subscriber': 'LEAD',
      'lead': 'LEAD',
      'marketingqualifiedlead': 'QUALIFIED',
      'salesqualifiedlead': 'QUALIFIED',
      'opportunity': 'OPPORTUNITY',
      'customer': 'CUSTOMER',
      'evangelist': 'CUSTOMER',
      'other': 'CHURNED',
    };
    return map[hsStage] ?? 'LEAD';
  }

  private mapDealStageToHubSpot(stage: string): string {
    const map: Record<string, string> = {
      'PROSPECT': 'appointmentscheduled',
      'NEGOTIATION': 'qualifiedtobuy',
      'PROPOSAL': 'presentationscheduled',
      'CLOSED_WON': 'closedwon',
      'CLOSED_LOST': 'closedlost',
    };
    return map[stage] ?? stage.toLowerCase();
  }

  private mapDealStageFromHubSpot(hsStage: string): string {
    const map: Record<string, string> = {
      'appointmentscheduled': 'PROSPECT',
      'qualifiedtobuy': 'NEGOTIATION',
      'presentationscheduled': 'PROPOSAL',
      'decisionmakerboughtin': 'NEGOTIATION',
      'contractsent': 'PROPOSAL',
      'closedwon': 'CLOSED_WON',
      'closedlost': 'CLOSED_LOST',
    };
    return map[hsStage] ?? 'PROSPECT';
  }

  private stageProbability(hsStage: string): number {
    const map: Record<string, number> = {
      'appointmentscheduled': 20,
      'qualifiedtobuy': 40,
      'presentationscheduled': 60,
      'decisionmakerboughtin': 80,
      'contractsent': 90,
      'closedwon': 100,
      'closedlost': 0,
    };
    return map[hsStage] ?? 10;
  }
}

// ─── HubSpot API Types ──────────────────────────────────────────────────────

interface HubSpotObject {
  id: string;
  properties: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

interface HubSpotListResult {
  results: HubSpotObject[];
  paging?: { next?: { after: string } };
}

interface HubSpotSearchResult {
  results: HubSpotObject[];
  total: number;
}
