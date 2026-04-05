export enum IntegrationProvider {
  GMAIL = 'GMAIL',
  GCAL = 'GCAL',
  SLACK = 'SLACK',
  GITHUB = 'GITHUB',
  NOTION = 'NOTION',
  HUBSPOT = 'HUBSPOT',
  DRIVE = 'DRIVE',
  PHORING = 'PHORING',
}

export enum IntegrationStatus {
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  NEEDS_REAUTH = 'NEEDS_REAUTH',
  ERROR = 'ERROR',
}

export interface Integration {
  id: string;
  tenantId: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  displayName?: string;
  scopes: string[];
  metadata?: Record<string, unknown>;
  lastUsedAt?: string;
  connectedBy: string;
  createdAt: string;
  updatedAt: string;
}
