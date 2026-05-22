import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../../config.js';
import { decrypt as decryptCredentials, encrypt as encryptCredentials } from '../../utils/crypto.js';
import { CompanyOperatingLayerService } from './company-operating-layer.service.js';
import { CompanyBrainSchemaUnavailableError } from './company-profile.service.js';
import {
  COMPANY_SYNC_PROVIDERS,
  type CompanySyncProvider,
  companySyncProviderToArtifactSource,
  getIntegrationProviderAliases,
  normalizeCompanySyncProvider,
} from './sync-provider-normalization.js';

interface IntegrationCredentialRow {
  id: string;
  integrationId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  expiresAt: Date | null;
}

interface IntegrationRow {
  id: string;
  tenantId: string;
  provider: string;
  status: string;
  displayName: string | null;
  metadata: unknown;
  updatedAt: Date;
  credentials: IntegrationCredentialRow | null;
}

interface ScheduledIntegrationRow {
  tenantId: string;
  provider: string;
  connectedBy: string;
  updatedAt: Date;
}

interface SyncStateRow {
  id: string;
  tenantId: string;
  provider: string;
  integrationProvider: string | null;
  status: string;
  cursorJson: unknown;
  lastSyncedAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  consecutiveFailures: number;
  createdAt: Date;
  updatedAt: Date;
}

interface SyncRunRow {
  id: string;
  syncStateId: string | null;
  tenantId: string;
  provider: string;
  trigger: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  fetchedCount: number;
  ingestedCount: number;
  skippedCount: number;
  errorMessage: string | null;
  cursorBeforeJson: unknown;
  cursorAfterJson: unknown;
  metadata: unknown;
}

type DbWithConnectorSync = PrismaClient & {
  integration: {
    findFirst: (args: unknown) => Promise<IntegrationRow | null>;
    findMany: (args: unknown) => Promise<ScheduledIntegrationRow[]>;
  };
  integrationCredential: {
    update: (args: unknown) => Promise<IntegrationCredentialRow>;
  };
  companyConnectorSyncState: {
    findUnique: (args: unknown) => Promise<SyncStateRow | null>;
    findMany: (args: unknown) => Promise<SyncStateRow[]>;
    upsert: (args: unknown) => Promise<SyncStateRow>;
    update: (args: unknown) => Promise<SyncStateRow>;
  };
  companyConnectorSyncRun: {
    create: (args: unknown) => Promise<SyncRunRow>;
    update: (args: unknown) => Promise<SyncRunRow>;
    findFirst: (args: unknown) => Promise<SyncRunRow | null>;
  };
};

export interface CompanyConnectorSyncStatus {
  provider: CompanySyncProvider;
  integrationProvider: string | null;
  connected: boolean;
  enabled: boolean;
  status: string;
  lastSyncedAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  consecutiveFailures: number;
  cursor: Record<string, unknown> | null;
  latestRun: {
    id: string;
    trigger: string;
    status: string;
    startedAt: Date;
    completedAt: Date | null;
    fetchedCount: number;
    ingestedCount: number;
    skippedCount: number;
    errorMessage: string | null;
  } | null;
}

export interface CompanyConnectorTriggerResult {
  provider: CompanySyncProvider;
  runId: string;
  status: string;
  fetchedCount: number;
  ingestedCount: number;
  skippedCount: number;
  cursor: Record<string, unknown> | null;
}

export interface CompanyConnectorScheduledTickResult {
  scanned: number;
  due: number;
  triggered: number;
  skipped: number;
  failed: number;
}

interface ProviderSyncResult {
  fetchedCount: number;
  ingestedCount: number;
  skippedCount: number;
  cursor: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  partial?: boolean;
}

function safeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return safeRecord(parsed);
  } catch {
    return null;
  }
}

function toDateIso(value: unknown): string | undefined {
  const s = asNonEmptyString(value);
  if (!s) return undefined;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function mapGitHubEventTypeToArtifactType(type: string): 'pull_request' | 'issue' | 'commit' | 'ticket' | 'other' {
  if (type === 'PullRequestEvent') return 'pull_request';
  if (type === 'IssuesEvent' || type === 'IssueCommentEvent') return 'issue';
  if (type === 'PushEvent') return 'commit';
  if (type === 'DiscussionEvent' || type === 'DiscussionCommentEvent') return 'ticket';
  return 'other';
}

function rethrowIfSyncSchemaMissing(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    /companyConnectorSyncState|companyConnectorSyncRun|company_connector_sync_states|company_connector_sync_runs/i.test(msg)
  ) {
    const schemaErr = new CompanyBrainSchemaUnavailableError();
    schemaErr.message =
      'Company connector sync schema is unavailable. Apply Prisma migration 108_company_connector_sync and regenerate Prisma client.';
    throw schemaErr;
  }
  throw err instanceof Error ? err : new Error(msg);
}

export class CompanyConnectorSyncService {
  private readonly db: DbWithConnectorSync;
  private readonly companyOperatingLayer: CompanyOperatingLayerService;

  constructor(db: PrismaClient, private readonly log?: FastifyBaseLogger) {
    this.db = db as DbWithConnectorSync;
    this.companyOperatingLayer = new CompanyOperatingLayerService(db, log);
  }

  private requireProvider(provider: string): CompanySyncProvider {
    const normalized = normalizeCompanySyncProvider(provider);
    if (!normalized) {
      throw new Error(
        `Unsupported provider '${provider}'. Supported providers: ${COMPANY_SYNC_PROVIDERS.join(', ')}`,
      );
    }
    return normalized;
  }

  private async findConnectedIntegration(tenantId: string, provider: CompanySyncProvider): Promise<IntegrationRow | null> {
    const providerAliases = getIntegrationProviderAliases(provider);
    return this.db.integration.findFirst({
      where: {
        tenantId,
        provider: { in: providerAliases },
        status: 'CONNECTED',
      },
      include: { credentials: true },
      orderBy: { updatedAt: 'desc' },
    }) as Promise<IntegrationRow | null>;
  }

  async listStatuses(input: { tenantId: string }): Promise<CompanyConnectorSyncStatus[]> {
    const items = await Promise.all(
      COMPANY_SYNC_PROVIDERS.map((provider) => this.getStatus({ tenantId: input.tenantId, provider })),
    );
    return items;
  }

  async getStatus(input: { tenantId: string; provider: string }): Promise<CompanyConnectorSyncStatus> {
    const provider = this.requireProvider(input.provider);

    const [state, integration, latestRun] = await Promise.all([
      this.db.companyConnectorSyncState.findUnique({
        where: { tenantId_provider: { tenantId: input.tenantId, provider } },
      }).catch((err: unknown) => rethrowIfSyncSchemaMissing(err)),
      this.findConnectedIntegration(input.tenantId, provider),
      this.db.companyConnectorSyncRun.findFirst({
        where: { tenantId: input.tenantId, provider },
        orderBy: { startedAt: 'desc' },
      }).catch((err: unknown) => rethrowIfSyncSchemaMissing(err)),
    ]);

    const fallbackStatus = integration ? 'idle' : 'not_connected';
    const status = state?.status ?? fallbackStatus;

    return {
      provider,
      integrationProvider: integration?.provider ?? state?.integrationProvider ?? null,
      connected: Boolean(integration),
      enabled: status !== 'disabled',
      status,
      lastSyncedAt: state?.lastSyncedAt ?? null,
      lastSuccessAt: state?.lastSuccessAt ?? null,
      lastError: state?.lastError ?? null,
      lastErrorAt: state?.lastErrorAt ?? null,
      consecutiveFailures: state?.consecutiveFailures ?? 0,
      cursor: safeRecord(state?.cursorJson ?? null),
      latestRun: latestRun
        ? {
          id: latestRun.id,
          trigger: latestRun.trigger,
          status: latestRun.status,
          startedAt: latestRun.startedAt,
          completedAt: latestRun.completedAt,
          fetchedCount: latestRun.fetchedCount,
          ingestedCount: latestRun.ingestedCount,
          skippedCount: latestRun.skippedCount,
          errorMessage: latestRun.errorMessage,
        }
        : null,
    };
  }

  async setProviderEnabled(input: {
    tenantId: string;
    provider: string;
    enabled: boolean;
  }): Promise<CompanyConnectorSyncStatus> {
    const provider = this.requireProvider(input.provider);
    const integration = await this.findConnectedIntegration(input.tenantId, provider);
    const nextStatus = input.enabled
      ? (integration ? 'idle' : 'not_connected')
      : 'disabled';

    await this.db.companyConnectorSyncState.upsert({
      where: { tenantId_provider: { tenantId: input.tenantId, provider } },
      create: {
        tenantId: input.tenantId,
        provider,
        integrationProvider: integration?.provider ?? null,
        status: nextStatus,
      },
      update: {
        integrationProvider: integration?.provider ?? null,
        status: nextStatus,
      },
    }).catch((err: unknown) => rethrowIfSyncSchemaMissing(err));

    return this.getStatus({ tenantId: input.tenantId, provider });
  }

  async triggerSync(input: {
    tenantId: string;
    userId: string;
    provider: string;
    forceFull?: boolean;
  }): Promise<CompanyConnectorTriggerResult> {
    const provider = this.requireProvider(input.provider);
    const integration = await this.findConnectedIntegration(input.tenantId, provider);

    if (!integration) {
      await this.db.companyConnectorSyncState.upsert({
        where: { tenantId_provider: { tenantId: input.tenantId, provider } },
        create: {
          tenantId: input.tenantId,
          provider,
          status: 'not_connected',
          integrationProvider: null,
        },
        update: {
          status: 'not_connected',
          integrationProvider: null,
        },
      }).catch((err: unknown) => rethrowIfSyncSchemaMissing(err));
      throw new Error(`Provider ${provider} is not connected for this tenant.`);
    }

    const state = await this.db.companyConnectorSyncState.upsert({
      where: { tenantId_provider: { tenantId: input.tenantId, provider } },
      create: {
        tenantId: input.tenantId,
        provider,
        integrationProvider: integration.provider,
        status: 'idle',
      },
      update: {
        integrationProvider: integration.provider,
      },
    }).catch((err: unknown) => rethrowIfSyncSchemaMissing(err));

    if (state.status === 'running') {
      throw new Error(`Provider ${provider} sync is already running.`);
    }
    if (state.status === 'disabled') {
      throw new Error(`Provider ${provider} sync is disabled. Enable it before triggering.`);
    }

    const cursorBefore = input.forceFull ? null : safeRecord(state.cursorJson);
    const startedAt = Date.now();

    const run = await this.db.companyConnectorSyncRun.create({
      data: {
        syncStateId: state.id,
        tenantId: input.tenantId,
        provider,
        trigger: input.forceFull ? 'manual_full' : 'manual',
        status: 'running',
        cursorBeforeJson: cursorBefore,
      },
    }).catch((err: unknown) => rethrowIfSyncSchemaMissing(err));

    await this.db.companyConnectorSyncState.update({
      where: { id: state.id },
      data: {
        integrationProvider: integration.provider,
        status: 'running',
      },
    }).catch((err: unknown) => rethrowIfSyncSchemaMissing(err));

    try {
      const result = await this.syncProvider({
        tenantId: input.tenantId,
        userId: input.userId,
        provider,
        integration,
        cursor: cursorBefore,
      });

      const completedAt = new Date();
      const durationMs = Math.max(0, Date.now() - startedAt);
      const runStatus = result.partial ? 'partial' : 'success';

      await this.db.companyConnectorSyncRun.update({
        where: { id: run.id },
        data: {
          status: runStatus,
          completedAt,
          durationMs,
          fetchedCount: result.fetchedCount,
          ingestedCount: result.ingestedCount,
          skippedCount: result.skippedCount,
          cursorAfterJson: result.cursor,
          metadata: result.metadata ?? {},
        },
      }).catch((err: unknown) => rethrowIfSyncSchemaMissing(err));

      await this.db.companyConnectorSyncState.update({
        where: { id: state.id },
        data: {
          integrationProvider: integration.provider,
          status: 'idle',
          cursorJson: result.cursor,
          lastSyncedAt: completedAt,
          lastSuccessAt: completedAt,
          lastError: null,
          lastErrorAt: null,
          consecutiveFailures: 0,
        },
      }).catch((err: unknown) => rethrowIfSyncSchemaMissing(err));

      return {
        provider,
        runId: run.id,
        status: runStatus,
        fetchedCount: result.fetchedCount,
        ingestedCount: result.ingestedCount,
        skippedCount: result.skippedCount,
        cursor: result.cursor,
      };
    } catch (err) {
      const completedAt = new Date();
      const durationMs = Math.max(0, Date.now() - startedAt);
      const msg = err instanceof Error ? err.message : String(err);

      await this.db.companyConnectorSyncRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          completedAt,
          durationMs,
          errorMessage: msg,
        },
      }).catch((updateErr: unknown) => rethrowIfSyncSchemaMissing(updateErr));

      await this.db.companyConnectorSyncState.update({
        where: { id: state.id },
        data: {
          status: 'error',
          lastError: msg,
          lastErrorAt: completedAt,
          consecutiveFailures: { increment: 1 },
        },
      }).catch((updateErr: unknown) => rethrowIfSyncSchemaMissing(updateErr));

      throw err;
    }
  }

  private nextScheduledRunAtMs(state: SyncStateRow | null, intervalMs: number): number {
    if (!state) return 0;
    if (state.status === 'not_connected') return 0;
    const anchor = state.lastErrorAt ?? state.lastSyncedAt;
    if (!anchor) return 0;

    const failures = Math.max(0, state.consecutiveFailures ?? 0);
    const multiplier = failures <= 0 ? 1 : Math.min(16, 2 ** Math.min(4, failures));
    return anchor.getTime() + intervalMs * multiplier;
  }

  async runScheduledTick(input: {
    intervalMs: number;
    maxRuns?: number;
    staleRunningMs?: number;
  }): Promise<CompanyConnectorScheduledTickResult> {
    const intervalMs = Math.max(30_000, Math.trunc(input.intervalMs));
    const maxRuns = Math.max(1, Math.trunc(input.maxRuns ?? 12));
    const staleRunningMs = Math.max(intervalMs, Math.trunc(input.staleRunningMs ?? 45 * 60 * 1000));

    const result: CompanyConnectorScheduledTickResult = {
      scanned: 0,
      due: 0,
      triggered: 0,
      skipped: 0,
      failed: 0,
    };

    const integrations = await this.db.integration.findMany({
      where: {
        status: 'CONNECTED',
        provider: { in: ['GITHUB', 'GMAIL', 'DRIVE', 'GOOGLE_DRIVE'] },
      },
      select: {
        tenantId: true,
        provider: true,
        connectedBy: true,
        updatedAt: true,
      },
    }) as ScheduledIntegrationRow[];

    const candidateByTenantProvider = new Map<string, ScheduledIntegrationRow & { canonicalProvider: CompanySyncProvider }>();
    for (const integration of integrations) {
      const canonicalProvider = normalizeCompanySyncProvider(integration.provider);
      if (!canonicalProvider) continue;

      const key = `${integration.tenantId}:${canonicalProvider}`;
      const existing = candidateByTenantProvider.get(key);
      if (!existing || integration.updatedAt.getTime() > existing.updatedAt.getTime()) {
        candidateByTenantProvider.set(key, { ...integration, canonicalProvider });
      }
    }

    if (candidateByTenantProvider.size === 0) {
      return result;
    }

    const tenantIds = Array.from(new Set(Array.from(candidateByTenantProvider.values()).map((item) => item.tenantId)));
    const states = await this.db.companyConnectorSyncState.findMany({
      where: {
        tenantId: { in: tenantIds },
        provider: { in: COMPANY_SYNC_PROVIDERS },
      },
    }).catch((err: unknown) => rethrowIfSyncSchemaMissing(err));

    const stateByTenantProvider = new Map<string, SyncStateRow>();
    for (const state of states) {
      stateByTenantProvider.set(`${state.tenantId}:${state.provider}`, state);
    }

    const now = new Date();
    const nowMs = now.getTime();
    for (const candidate of candidateByTenantProvider.values()) {
      result.scanned += 1;
      const stateKey = `${candidate.tenantId}:${candidate.canonicalProvider}`;
      let state = stateByTenantProvider.get(stateKey) ?? null;

      if (state?.status === 'disabled') {
        result.skipped += 1;
        continue;
      }

      if (state?.status === 'running') {
        const ageMs = nowMs - state.updatedAt.getTime();
        if (ageMs < staleRunningMs) {
          result.skipped += 1;
          continue;
        }

        const staleMessage =
          `Scheduler marked stale running sync for ${candidate.canonicalProvider} after ${Math.floor(ageMs / 1000)}s without completion.`;
        state = await this.db.companyConnectorSyncState.update({
          where: { id: state.id },
          data: {
            status: 'error',
            lastError: staleMessage,
            lastErrorAt: now,
            consecutiveFailures: { increment: 1 },
          },
        }).catch((err: unknown) => rethrowIfSyncSchemaMissing(err));
        stateByTenantProvider.set(stateKey, state);
      }

      const nextEligibleAtMs = this.nextScheduledRunAtMs(state, intervalMs);
      if (nextEligibleAtMs > nowMs) {
        result.skipped += 1;
        continue;
      }

      result.due += 1;
      if (result.triggered >= maxRuns) {
        result.skipped += 1;
        continue;
      }

      try {
        await this.triggerSync({
          tenantId: candidate.tenantId,
          userId: asNonEmptyString(candidate.connectedBy) ?? `system-sync:${candidate.tenantId}`,
          provider: candidate.canonicalProvider,
        });
        result.triggered += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/already running|not connected|disabled/i.test(message)) {
          result.skipped += 1;
          continue;
        }

        result.failed += 1;
        this.log?.warn(
          {
            tenantId: candidate.tenantId,
            provider: candidate.canonicalProvider,
            err: message,
          },
          '[company-sync] scheduled trigger failed',
        );
      }
    }

    return result;
  }

  private async syncProvider(input: {
    tenantId: string;
    userId: string;
    provider: CompanySyncProvider;
    integration: IntegrationRow;
    cursor: Record<string, unknown> | null;
  }): Promise<ProviderSyncResult> {
    if (input.provider === 'GITHUB') {
      return this.syncGitHub(input);
    }
    if (input.provider === 'GMAIL') {
      return this.syncGmail(input);
    }
    return this.syncGoogleDrive(input);
  }

  private async syncGitHub(input: {
    tenantId: string;
    userId: string;
    provider: CompanySyncProvider;
    integration: IntegrationRow;
    cursor: Record<string, unknown> | null;
  }): Promise<ProviderSyncResult> {
    const token = await this.resolveGitHubAccessToken(input.integration);
    if (!token) {
      throw new Error('GitHub integration is connected but no usable access token was found. Reconnect GitHub.');
    }

    const res = await fetch('https://api.github.com/user/events?per_page=50', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'jak-company-sync',
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GitHub API failed (${res.status}): ${body.slice(0, 300)}`);
    }

    const rawEvents = await res.json() as unknown;
    const events = Array.isArray(rawEvents)
      ? rawEvents.filter((item) => Boolean(safeRecord(item))) as Array<Record<string, unknown>>
      : [];

    const cursorEventIso = asNonEmptyString(input.cursor?.['lastEventAtIso']);
    const sinceMs = cursorEventIso ? Date.parse(cursorEventIso) : 0;

    const candidates = events
      .map((event) => ({
        event,
        createdAt: asNonEmptyString(event['created_at']),
      }))
      .filter((item) => {
        if (!item.createdAt) return false;
        const createdAtMs = Date.parse(item.createdAt);
        return Number.isFinite(createdAtMs) && createdAtMs > sinceMs;
      })
      .sort((a, b) => Date.parse(a.createdAt ?? '') - Date.parse(b.createdAt ?? ''));

    let ingestedCount = 0;
    let invalidCount = 0;
    let newestEventIso = cursorEventIso ?? null;
    const perItemErrors: string[] = [];

    for (const candidate of candidates) {
      const event = candidate.event;
      const createdAt = candidate.createdAt;
      const eventId = asNonEmptyString(event['id']);
      const eventType = asNonEmptyString(event['type']) ?? 'UnknownEvent';
      if (!eventId || !createdAt) {
        invalidCount += 1;
        continue;
      }

      const repo = safeRecord(event['repo']);
      const repoName = asNonEmptyString(repo?.['name']) ?? 'unknown/repo';
      const actor = safeRecord(event['actor']);
      const payload = safeRecord(event['payload']) ?? {};
      const authorName = asNonEmptyString(actor?.['login']) ?? undefined;

      const artifactType = mapGitHubEventTypeToArtifactType(eventType);
      const payloadJson = JSON.stringify(payload).slice(0, 5000);
      const sourceUrl =
        asNonEmptyString((safeRecord(payload['pull_request']) ?? {})['html_url']) ??
        asNonEmptyString((safeRecord(payload['issue']) ?? {})['html_url']) ??
        asNonEmptyString((safeRecord(payload['comment']) ?? {})['html_url']) ??
        asNonEmptyString((safeRecord(payload['release']) ?? {})['html_url']) ??
        (() => {
          const head = asNonEmptyString(payload['head']);
          if (head) return `https://github.com/${repoName}/commit/${head}`;
          return `https://github.com/${repoName}`;
        })();

      const body = [
        `GitHub ${eventType} in ${repoName}.`,
        `Event ID: ${eventId}`,
        `Occurred At: ${createdAt}`,
        `Payload: ${payloadJson}`,
      ].join('\n');

      try {
        await this.companyOperatingLayer.createArtifact({
          tenantId: input.tenantId,
          userId: input.userId,
          sourceType: companySyncProviderToArtifactSource(input.provider),
          artifactType,
          title: `${repoName}: ${eventType}`,
          body,
          externalId: eventId,
          sourceUrl,
          authorName,
          occurredAt: createdAt,
          metadata: {
            eventType,
            repoName,
            integrationProvider: input.integration.provider,
            payload,
          },
        });
        ingestedCount += 1;
      } catch (itemErr) {
        perItemErrors.push(itemErr instanceof Error ? itemErr.message : String(itemErr));
      }

      if (!newestEventIso || Date.parse(createdAt) > Date.parse(newestEventIso)) {
        newestEventIso = createdAt;
      }
    }

    const skippedCount = (events.length - candidates.length) + invalidCount + perItemErrors.length;
    return {
      fetchedCount: events.length,
      ingestedCount,
      skippedCount,
      cursor: newestEventIso ? { lastEventAtIso: newestEventIso } : input.cursor,
      metadata: perItemErrors.length > 0
        ? { warnings: perItemErrors.slice(0, 20) }
        : undefined,
      partial: perItemErrors.length > 0,
    };
  }

  private async syncGmail(input: {
    tenantId: string;
    userId: string;
    provider: CompanySyncProvider;
    integration: IntegrationRow;
    cursor: Record<string, unknown> | null;
  }): Promise<ProviderSyncResult> {
    const accessToken = await this.resolveGoogleAccessToken(input.integration);
    if (!accessToken) {
      throw new Error('Gmail integration is connected but no usable OAuth token was found. Reconnect Gmail.');
    }

    const previousCursorMs = Number(input.cursor?.['lastInternalDateMs'] ?? 0);
    const afterSeconds = Number.isFinite(previousCursorMs) && previousCursorMs > 0
      ? Math.max(0, Math.floor((previousCursorMs - 60_000) / 1000))
      : 0;

    const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    listUrl.searchParams.set('maxResults', '25');
    if (afterSeconds > 0) {
      listUrl.searchParams.set('q', `after:${afterSeconds}`);
    }

    const listRes = await fetch(listUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!listRes.ok) {
      const body = await listRes.text().catch(() => '');
      throw new Error(`Gmail API failed (${listRes.status}): ${body.slice(0, 300)}`);
    }

    const listJson = await listRes.json() as { messages?: Array<{ id?: string }> };
    const messages = Array.isArray(listJson.messages) ? listJson.messages : [];

    let ingestedCount = 0;
    let skippedCount = 0;
    let newestInternalDateMs = previousCursorMs > 0 ? previousCursorMs : 0;
    const perItemErrors: string[] = [];

    for (const message of messages) {
      const messageId = asNonEmptyString(message.id);
      if (!messageId) {
        skippedCount += 1;
        continue;
      }

      const detailUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`);
      detailUrl.searchParams.set('format', 'metadata');
      detailUrl.searchParams.append('metadataHeaders', 'Subject');
      detailUrl.searchParams.append('metadataHeaders', 'From');
      detailUrl.searchParams.append('metadataHeaders', 'Date');

      const detailRes = await fetch(detailUrl.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!detailRes.ok) {
        skippedCount += 1;
        const errorBody = await detailRes.text().catch(() => '');
        perItemErrors.push(`message:${messageId} status:${detailRes.status} ${errorBody.slice(0, 160)}`);
        continue;
      }

      const detailJson = await detailRes.json() as Record<string, unknown>;
      const internalDateMs = Number(detailJson['internalDate'] ?? 0);
      if (Number.isFinite(internalDateMs) && previousCursorMs > 0 && internalDateMs <= previousCursorMs) {
        skippedCount += 1;
        continue;
      }

      const payload = safeRecord(detailJson['payload']);
      const headers = Array.isArray(payload?.['headers']) ? payload?.['headers'] as Array<Record<string, unknown>> : [];
      const headerMap = new Map<string, string>();
      for (const header of headers) {
        const name = asNonEmptyString(header['name']);
        const value = asNonEmptyString(header['value']);
        if (name && value) headerMap.set(name.toLowerCase(), value);
      }

      const subject = headerMap.get('subject') ?? `Email ${messageId}`;
      const from = headerMap.get('from') ?? undefined;
      const dateHeaderIso = toDateIso(headerMap.get('date'));
      const occurredAtIso = Number.isFinite(internalDateMs) && internalDateMs > 0
        ? new Date(internalDateMs).toISOString()
        : dateHeaderIso;
      const snippet = asNonEmptyString(detailJson['snippet']) ?? 'No preview text available.';

      const body = [
        `Subject: ${subject}`,
        `From: ${from ?? 'Unknown sender'}`,
        `Snippet: ${snippet}`,
      ].join('\n');

      try {
        await this.companyOperatingLayer.createArtifact({
          tenantId: input.tenantId,
          userId: input.userId,
          sourceType: companySyncProviderToArtifactSource(input.provider),
          artifactType: 'email',
          title: subject,
          body,
          externalId: messageId,
          sourceUrl: `https://mail.google.com/mail/u/0/#all/${messageId}`,
          authorName: from,
          occurredAt: occurredAtIso,
          metadata: {
            threadId: asNonEmptyString(detailJson['threadId']),
            labelIds: Array.isArray(detailJson['labelIds']) ? detailJson['labelIds'] : [],
            integrationProvider: input.integration.provider,
          },
        });
        ingestedCount += 1;
      } catch (itemErr) {
        skippedCount += 1;
        perItemErrors.push(itemErr instanceof Error ? itemErr.message : String(itemErr));
      }

      if (Number.isFinite(internalDateMs) && internalDateMs > newestInternalDateMs) {
        newestInternalDateMs = internalDateMs;
      }
    }

    return {
      fetchedCount: messages.length,
      ingestedCount,
      skippedCount,
      cursor: newestInternalDateMs > 0 ? { lastInternalDateMs: newestInternalDateMs } : input.cursor,
      metadata: perItemErrors.length > 0
        ? { warnings: perItemErrors.slice(0, 20) }
        : undefined,
      partial: perItemErrors.length > 0,
    };
  }

  private async syncGoogleDrive(input: {
    tenantId: string;
    userId: string;
    provider: CompanySyncProvider;
    integration: IntegrationRow;
    cursor: Record<string, unknown> | null;
  }): Promise<ProviderSyncResult> {
    const accessToken = await this.resolveGoogleAccessToken(input.integration);
    if (!accessToken) {
      throw new Error('Google Drive integration is connected but no usable access token was found. Reconnect Drive.');
    }

    const listUrl = new URL('https://www.googleapis.com/drive/v3/files');
    listUrl.searchParams.set('q', 'trashed=false');
    listUrl.searchParams.set('orderBy', 'modifiedTime desc');
    listUrl.searchParams.set('pageSize', '100');
    listUrl.searchParams.set(
      'fields',
      'files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName),size),nextPageToken',
    );

    const listRes = await fetch(listUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!listRes.ok) {
      const body = await listRes.text().catch(() => '');
      throw new Error(`Google Drive API failed (${listRes.status}): ${body.slice(0, 300)}`);
    }

    const listJson = await listRes.json() as { files?: Array<Record<string, unknown>> };
    const files = Array.isArray(listJson.files)
      ? listJson.files.filter((file) => Boolean(safeRecord(file))) as Array<Record<string, unknown>>
      : [];

    const previousModifiedIso = asNonEmptyString(input.cursor?.['lastModifiedAtIso']);
    const previousModifiedMs = previousModifiedIso ? Date.parse(previousModifiedIso) : 0;

    const candidates = files
      .map((file) => ({
        file,
        modifiedTime: asNonEmptyString(file['modifiedTime']),
      }))
      .filter((item) => {
        if (!item.modifiedTime) return false;
        const ms = Date.parse(item.modifiedTime);
        return Number.isFinite(ms) && ms > previousModifiedMs;
      })
      .sort((a, b) => Date.parse(a.modifiedTime ?? '') - Date.parse(b.modifiedTime ?? ''));

    let ingestedCount = 0;
    let invalidCount = 0;
    let newestModifiedIso = previousModifiedIso ?? null;
    const perItemErrors: string[] = [];

    for (const candidate of candidates) {
      const file = candidate.file;
      const fileId = asNonEmptyString(file['id']);
      const name = asNonEmptyString(file['name']) ?? 'Untitled Drive file';
      const modifiedTime = candidate.modifiedTime;
      if (!fileId || !modifiedTime) {
        invalidCount += 1;
        continue;
      }

      const mimeType = asNonEmptyString(file['mimeType']) ?? 'application/octet-stream';
      const webViewLink = asNonEmptyString(file['webViewLink']) ?? undefined;
      const owners = Array.isArray(file['owners']) ? file['owners'] : [];
      const ownerName = owners.length > 0
        ? asNonEmptyString((safeRecord(owners[0]) ?? {})['displayName']) ?? undefined
        : undefined;

      const body = [
        `Google Drive file: ${name}`,
        `Mime type: ${mimeType}`,
        `Modified: ${modifiedTime}`,
        `Open: ${webViewLink ?? 'N/A'}`,
      ].join('\n');

      try {
        await this.companyOperatingLayer.createArtifact({
          tenantId: input.tenantId,
          userId: input.userId,
          sourceType: companySyncProviderToArtifactSource(input.provider),
          artifactType: 'document',
          title: name,
          body,
          externalId: fileId,
          sourceUrl: webViewLink,
          authorName: ownerName,
          occurredAt: modifiedTime,
          metadata: {
            mimeType,
            size: asNonEmptyString(file['size']) ?? null,
            integrationProvider: input.integration.provider,
            owners,
          },
        });
        ingestedCount += 1;
      } catch (itemErr) {
        perItemErrors.push(itemErr instanceof Error ? itemErr.message : String(itemErr));
      }

      if (!newestModifiedIso || Date.parse(modifiedTime) > Date.parse(newestModifiedIso)) {
        newestModifiedIso = modifiedTime;
      }
    }

    const skippedCount = (files.length - candidates.length) + invalidCount + perItemErrors.length;
    return {
      fetchedCount: files.length,
      ingestedCount,
      skippedCount,
      cursor: newestModifiedIso ? { lastModifiedAtIso: newestModifiedIso } : input.cursor,
      metadata: perItemErrors.length > 0
        ? { warnings: perItemErrors.slice(0, 20) }
        : undefined,
      partial: perItemErrors.length > 0,
    };
  }

  private async resolveGitHubAccessToken(integration: IntegrationRow): Promise<string | null> {
    if (!integration.credentials?.accessTokenEnc) return null;
    const decrypted = decryptCredentials(integration.credentials.accessTokenEnc);
    const metadata = safeRecord(integration.metadata);
    if (metadata?.['connectedViaOAuth'] === true) {
      return asNonEmptyString(decrypted);
    }

    const parsed = parseJsonRecord(decrypted);
    if (parsed) {
      return (
        asNonEmptyString(parsed['token']) ??
        asNonEmptyString(parsed['pat']) ??
        asNonEmptyString(parsed['accessToken'])
      );
    }

    return asNonEmptyString(decrypted);
  }

  private async resolveGoogleAccessToken(integration: IntegrationRow): Promise<string | null> {
    if (!integration.credentials?.accessTokenEnc) return null;

    const metadata = safeRecord(integration.metadata);
    const connectedViaOAuth = metadata?.['connectedViaOAuth'] === true;

    if (connectedViaOAuth) {
      const accessToken = asNonEmptyString(decryptCredentials(integration.credentials.accessTokenEnc));
      const expiresAtMs = integration.credentials.expiresAt?.getTime() ?? 0;
      if (accessToken && (!expiresAtMs || expiresAtMs > Date.now() + 60_000)) {
        return accessToken;
      }

      const refreshToken = integration.credentials.refreshTokenEnc
        ? asNonEmptyString(decryptCredentials(integration.credentials.refreshTokenEnc))
        : null;
      if (!refreshToken) return accessToken;
      if (!config.googleOAuthClientId || !config.googleOAuthClientSecret) return accessToken;

      const refreshed = await this.refreshGoogleAccessToken({
        clientId: config.googleOAuthClientId,
        clientSecret: config.googleOAuthClientSecret,
        refreshToken,
      });
      if (!refreshed) return accessToken;

      await this.db.integrationCredential.update({
        where: { integrationId: integration.id },
        data: {
          accessTokenEnc: encryptCredentials(refreshed.accessToken),
          refreshTokenEnc: refreshed.refreshToken
            ? encryptCredentials(refreshed.refreshToken)
            : integration.credentials.refreshTokenEnc,
          expiresAt: refreshed.expiresAt,
        },
      });

      return refreshed.accessToken;
    }

    const decrypted = decryptCredentials(integration.credentials.accessTokenEnc);
    const parsed = parseJsonRecord(decrypted);
    if (!parsed) {
      return asNonEmptyString(decrypted);
    }

    const staticToken = asNonEmptyString(parsed['accessToken']);
    if (staticToken) return staticToken;

    const refreshToken = asNonEmptyString(parsed['refreshToken']);
    const clientId = asNonEmptyString(parsed['clientId']);
    const clientSecret = asNonEmptyString(parsed['clientSecret']);
    if (!refreshToken || !clientId || !clientSecret) {
      return null;
    }

    const refreshed = await this.refreshGoogleAccessToken({ clientId, clientSecret, refreshToken });
    return refreshed?.accessToken ?? null;
  }

  private async refreshGoogleAccessToken(input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }): Promise<{ accessToken: string; refreshToken?: string; expiresAt: Date | null } | null> {
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: input.clientId,
          client_secret: input.clientSecret,
          refresh_token: input.refreshToken,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.log?.warn({ status: res.status, body: body.slice(0, 200) }, '[company-sync] Google token refresh failed');
        return null;
      }

      const json = await res.json() as Record<string, unknown>;
      const accessToken = asNonEmptyString(json['access_token']);
      if (!accessToken) return null;

      const expiresIn = typeof json['expires_in'] === 'number'
        ? Math.max(0, json['expires_in'])
        : null;
      const expiresAt = expiresIn !== null
        ? new Date(Date.now() + Math.max(0, expiresIn - 60) * 1000)
        : null;

      return {
        accessToken,
        refreshToken: asNonEmptyString(json['refresh_token']) ?? undefined,
        expiresAt,
      };
    } catch (err) {
      this.log?.warn({ err: err instanceof Error ? err.message : String(err) }, '[company-sync] Google token refresh exception');
      return null;
    }
  }
}
