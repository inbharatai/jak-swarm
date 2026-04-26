import type { ApiError, ApprovalRequest, Integration, PaginatedResult, Workflow } from '@/types';
import { createClient } from './supabase';

const BASE_URL = (process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000').trim();

let cachedToken: string | null = null;
let tokenExpiresAt = 0;
const TOKEN_CACHE_TTL_MS = 30_000; // 30 seconds

async function getToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) return cachedToken;
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    cachedToken = data?.session?.access_token ?? null;
    tokenExpiresAt = now + TOKEN_CACHE_TTL_MS;
    return cachedToken;
  } catch {
    cachedToken = null;
    tokenExpiresAt = 0;
    return null;
  }
}

function clearSession(): void {
  if (typeof window === 'undefined') return;
  cachedToken = null;
  tokenExpiresAt = 0;
  const supabase = createClient();
  supabase.auth.signOut();
  window.location.href = '/login';
}

function normalizeErrorDetails(value: unknown): Record<string, string[]> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const normalized: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(raw)) {
      normalized[key] = raw.map((item) => String(item));
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const token = await getToken();

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options: RequestInit = {
    method,
    headers,
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (response.status === 401) {
    clearSession();
    throw { message: 'Unauthorized', code: 'UNAUTHORIZED', status: 401 } as ApiError;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const envelope = (json && typeof json === 'object' ? json : null) as
      | { error?: { code?: string; message?: string; details?: unknown }; code?: string; message?: string; details?: unknown }
      | null;

    const error: ApiError = {
      message: envelope?.error?.message ?? envelope?.message ?? response.statusText ?? 'Request failed',
      code: envelope?.error?.code ?? envelope?.code ?? 'UNKNOWN_ERROR',
      status: response.status,
      details: normalizeErrorDetails(envelope?.error?.details ?? envelope?.details),
    };
    throw error;
  }

  return json as T;
}

function unwrapApiData<T>(payload: unknown): T {
  if (
    payload &&
    typeof payload === 'object' &&
    'success' in payload &&
    (payload as { success?: unknown }).success === true &&
    'data' in payload
  ) {
    return (payload as { data: T }).data;
  }

  return payload as T;
}

async function requestData<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const payload = await request<unknown>(method, path, body);
  return unwrapApiData<T>(payload);
}

export const apiClient = {
  get<T>(path: string): Promise<T> {
    return request<T>('GET', path);
  },

  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>('POST', path, body);
  },

  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>('PATCH', path, body);
  },

  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>('PUT', path, body);
  },

  delete<T>(path: string): Promise<T> {
    return request<T>('DELETE', path);
  },
};

/** SWR-compatible fetcher. Use as: useSWR<T>(key, fetcher) */
export function fetcher<T>(url: string): Promise<T> {
  return apiClient.get<T>(url);
}

/** SWR-compatible fetcher that unwraps { success: true, data } envelopes. */
export function dataFetcher<T>(url: string): Promise<T> {
  return requestData<T>('GET', url);
}

/** Generic fetch helper for use in components */
export function apiFetch<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const method = options?.method ?? 'GET';
  return request<T>(method, path, options?.body);
}

/** Generic fetch helper that unwraps { success: true, data } envelopes. */
export function apiDataFetch<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const method = options?.method ?? 'GET';
  return requestData<T>(method, path, options?.body);
}

// ─── Typed API endpoints ──────────────────────────────────────────────────────
// NOTE: Routes are registered on the Fastify server without an /api prefix.
// BASE_URL already points to the API server (http://localhost:4000).

export const authApi = {
  /** POST /auth/login */
  login: (email: string, password: string) =>
    apiClient.post<unknown>('/auth/login', { email, password }),

  /** POST /auth/register */
  register: (data: {
    email: string;
    password: string;
    name: string;
    tenantName: string;
    industry?: string;
  }) => apiClient.post<unknown>('/auth/register', data),

  /** GET /auth/me */
  me: () => apiClient.get<unknown>('/auth/me'),
};

export const workflowApi = {
  /** GET /workflows?page=&limit=&status= */
  list: (params?: Record<string, string | number>) => {
    const qs = params
      ? '?' + new URLSearchParams(params as Record<string, string>).toString()
      : '';
    return apiDataFetch<PaginatedResult<Workflow>>(`/workflows${qs}`);
  },

  /** GET /workflows/:id */
  get: (id: string) => apiDataFetch<Workflow>(`/workflows/${id}`),

  /**
   * POST /workflows — returns 202 Accepted immediately.
   * Use workflowApi.get() to poll for status changes.
   */
  create: (goal: string, industry?: string, roleModes?: string[]) =>
    apiDataFetch<Workflow & { estimatedCredits?: number; creditsReserved?: number; taskType?: string; model?: string }>(
      '/workflows',
      { method: 'POST', body: { goal, industry, roleModes } },
    ),

  /**
   * POST /workflows/:id/resume — send approval decision to resume a PAUSED workflow.
   * decision: 'APPROVED' | 'REJECTED' | 'DEFERRED'
   */
  resume: (id: string, decision: 'APPROVED' | 'REJECTED' | 'DEFERRED', comment?: string) =>
    apiDataFetch<unknown>(`/workflows/${id}/resume`, { method: 'POST', body: { decision, comment } }),

  /** DELETE /workflows/:id — cancel a running workflow */
  cancel: (id: string) => apiDataFetch<unknown>(`/workflows/${id}`, { method: 'DELETE' }),

  /** Pause a running workflow (pauses between nodes) */
  pause: (id: string) => apiDataFetch<unknown>(`/workflows/${id}/pause`, { method: 'POST' }),

  /** Resume a paused workflow */
  unpause: (id: string) => apiDataFetch<unknown>(`/workflows/${id}/unpause`, { method: 'POST' }),

  /** Alias: stop = cancel */
  stop: (id: string) => apiDataFetch<unknown>(`/workflows/${id}/stop`, { method: 'POST' }),
  stopAll: async () => {
    const res = await workflowApi.list({ status: 'RUNNING' });
    const running = res.items ?? [];
    await Promise.allSettled(running.map(w => workflowApi.cancel(w.id)));
  },

  /** GET /workflows/:id/traces */
  traces: (id: string) => apiDataFetch<unknown>(`/workflows/${id}/traces`),

  /** GET /workflows/:id/approvals */
  approvals: (id: string) => apiDataFetch<ApprovalRequest[]>(`/workflows/${id}/approvals`),
};

export const approvalApi = {
  /** GET /approvals?status=PENDING */
  list: (status?: string) =>
    apiDataFetch<PaginatedResult<ApprovalRequest>>(`/approvals${status ? `?status=${status}` : ''}`),

  /** GET /approvals/:id */
  get: (id: string) => apiDataFetch<ApprovalRequest>(`/approvals/${id}`),

  /**
   * POST /approvals/:id/decide — unified decision endpoint.
   * decision: 'APPROVED' | 'REJECTED' | 'DEFERRED'
   */
  decide: (id: string, decision: 'APPROVED' | 'REJECTED' | 'DEFERRED', comment?: string) =>
    apiDataFetch<ApprovalRequest>(`/approvals/${id}/decide`, { method: 'POST', body: { decision, comment } }),

  approve: (id: string, comment?: string) =>
    apiDataFetch<ApprovalRequest>(`/approvals/${id}/decide`, { method: 'POST', body: { decision: 'APPROVED', comment } }),

  reject: (id: string, comment?: string) =>
    apiDataFetch<ApprovalRequest>(`/approvals/${id}/decide`, { method: 'POST', body: { decision: 'REJECTED', comment } }),

  /** POST /approvals/:id/defer */
  defer: (id: string, comment?: string) =>
    apiDataFetch<ApprovalRequest>(`/approvals/${id}/defer`, { method: 'POST', body: { comment } }),
};

export const traceApi = {
  /** GET /traces?workflowId=&agentRole=&page= */
  list: (params?: Record<string, string | number>) => {
    const qs = params
      ? '?' + new URLSearchParams(params as Record<string, string>).toString()
      : '';
    return apiClient.get<unknown>(`/traces${qs}`);
  },

  /** GET /traces/:id */
  get: (id: string) => apiClient.get<unknown>(`/traces/${id}`),
};

export const memoryApi = {
  /** GET /memory?type=&key= */
  list: (params?: Record<string, string | number>) => {
    const qs = params
      ? '?' + new URLSearchParams(params as Record<string, string>).toString()
      : '';
    return apiDataFetch<unknown>(`/memory${qs}`);
  },

  /** PUT /memory/:key */
  create: (entry: { type: string; key: string; value: unknown; expiresAt?: string }) =>
    apiDataFetch<unknown>(`/memory/${encodeURIComponent(entry.key)}`, {
      method: 'PUT',
      body: {
        value: entry.value,
        type: entry.type,
        ttl: entry.expiresAt,
      },
    }),

  /** PUT /memory/:key */
  update: (key: string, value: unknown, type?: string, expiresAt?: string) =>
    apiDataFetch<unknown>(`/memory/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: {
        value,
        ...(type ? { type } : {}),
        ...(expiresAt ? { ttl: expiresAt } : {}),
      },
    }),

  /** DELETE /memory/:key */
  delete: (key: string) => apiDataFetch<unknown>(`/memory/${encodeURIComponent(key)}`, { method: 'DELETE' }),
};

export const skillApi = {
  /** GET /skills?status=&tier= */
  list: (params?: Record<string, string>) => {
    const qs = params
      ? '?' + new URLSearchParams(params).toString()
      : '';
    return apiClient.get<unknown>(`/skills${qs}`);
  },

  /** GET /skills/:id */
  get: (id: string) => apiClient.get<unknown>(`/skills/${id}`),

  /** POST /skills/propose — propose a new skill */
  propose: (skill: Record<string, unknown>) => apiDataFetch<unknown>('/skills/propose', { method: 'POST', body: skill }),

  /** POST /skills/:id/approve */
  approve: (id: string) => apiClient.post<unknown>(`/skills/${id}/approve`, {}),

  /** POST /skills/:id/reject */
  reject: (id: string, reason: string) =>
    apiClient.post<unknown>(`/skills/${id}/reject`, { reason }),
};

export const toolApi = {
  /** GET /tools */
  list: () => apiClient.get<unknown>('/tools'),

  /** POST /tools/:toolName/execute */
  execute: (toolName: string, input: unknown) =>
    apiClient.post<unknown>(`/tools/${toolName}/execute`, input),
};

// ─── Documents API (Track 2) ────────────────────────────────────────────────

export interface TenantDocument {
  id: string;
  tenantId: string;
  uploadedBy: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  contentHash: string | null;
  status: 'PENDING' | 'INDEXED' | 'FAILED' | 'DELETED';
  ingestionError: string | null;
  tags: string[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  /** Included only on GET /documents/:id — short-lived signed URL. */
  signedUrl?: string;
  signedUrlExpiresIn?: number;
}

export interface DocumentListResponse {
  items: TenantDocument[];
  total: number;
  limit: number;
  offset: number;
}

export const documentApi = {
  /** GET /documents — paginated list of tenant documents. */
  list: (params?: { limit?: number; offset?: number; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    if (params?.status) q.set('status', params.status);
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return apiFetch<{ success: true; data: DocumentListResponse }>(`/documents${suffix}`);
  },

  /** GET /documents/:id — metadata + fresh signed URL. */
  get: (id: string) =>
    apiFetch<{ success: true; data: TenantDocument }>(`/documents/${id}`),

  /**
   * POST /documents/upload — multipart/form-data.
   *
   * Uses raw fetch instead of the JSON-default `apiClient.post` because the
   * multipart body must carry a FormData payload + browser-managed Content-Type
   * boundary. Auth header is injected via getToken() the same way other calls do.
   */
  upload: async (file: File, opts?: { tags?: string[]; metadata?: Record<string, unknown> }) => {
    const token = await getToken();
    const formData = new FormData();
    formData.append('file', file);
    if (opts?.tags && opts.tags.length > 0) {
      formData.append('tags', opts.tags.join(','));
    }
    if (opts?.metadata) {
      formData.append('metadataJson', JSON.stringify(opts.metadata));
    }

    const response = await fetch(`${BASE_URL}/documents/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: { message: 'Upload failed' } }));
      throw {
        message: err.error?.message ?? 'Upload failed',
        code: err.error?.code ?? 'UPLOAD_FAILED',
        status: response.status,
      } as ApiError;
    }

    return response.json() as Promise<{ success: true; data: TenantDocument }>;
  },

  /** DELETE /documents/:id — removes storage object + cascades chunk cleanup. */
  delete: (id: string) =>
    apiClient.delete<{ success: true; data: { id: string; deleted: true } }>(
      `/documents/${id}`,
    ),
};

export const voiceApi = {
  /**
   * Alias for createSession — used by the VoiceInput hook.
   * @deprecated use createSession
   */
  getSessionConfig: (options?: { language?: string; voice?: string; workflowId?: string }) =>
    apiClient.post<unknown>('/voice/sessions', options ?? {}),

  /**
   * POST /voice/sessions — create a voice session.
   * Returns { sessionId, webRtcConfig, expiresInSeconds }
   */
  createSession: (options?: { language?: string; voice?: string; workflowId?: string }) =>
    apiClient.post<{
      success: true;
      data: {
        sessionId: string;
        webRtcConfig: Record<string, unknown>;
        expiresInSeconds: number;
      };
    }>('/voice/sessions', options ?? {}),

  /**
   * GET /voice/sessions/:sessionId/token — obtain an ephemeral WebRTC token.
   * The browser uses this token to connect directly to OpenAI Realtime.
   */
  getToken: (sessionId: string) =>
    apiClient.get<{
      success: true;
      data: {
        sessionId: string;
        clientToken: string;
        model: string;
        expiresAt: string;
        isMock: boolean;
      };
    }>(`/voice/sessions/${sessionId}/token`),

  /** DELETE /voice/sessions/:sessionId — end a session */
  endSession: (sessionId: string) =>
    apiClient.delete<unknown>(`/voice/sessions/${sessionId}`),

  /** GET /voice/sessions/:sessionId/transcript */
  getTranscript: (sessionId: string) =>
    apiClient.get<unknown>(`/voice/sessions/${sessionId}/transcript`),
};

// ─── Admin API ────────────────────────────────────────────────────────────────

export const integrationApi = {
  list: () => apiDataFetch<Integration[]>('/integrations'),
  disconnect: (id: string) => apiDataFetch<void>(`/integrations/${id}`, { method: 'DELETE' }),
  connect: (provider: string, credentials: Record<string, string>) =>
    apiDataFetch<{ id: string; provider: string; status: string; toolsRegistered: string[] }>(
      '/integrations/connect',
      { method: 'POST', body: { provider, credentials } },
    ),
  getProviderInfo: (provider: string) =>
    apiDataFetch<{
      name: string;
      description: string;
      credentialFields: Array<{ key: string; label: string; placeholder: string; type: string; helpUrl?: string }>;
      setupInstructions: string;
      isMcp?: boolean;
      maturity?: 'production-ready' | 'beta' | 'partial' | 'placeholder';
      note?: string;
    }>(
      `/integrations/providers/${provider}`,
    ),
  test: (id: string) =>
    apiDataFetch<{ connected: boolean; toolCount: number; tools: string[] }>(
      `/integrations/${id}/test`,
      { method: 'POST' },
    ),
  // Start an OAuth authorization. Returns the provider's auth URL the browser
  // should be redirected to. The callback URL is server-side config; the
  // frontend just follows the URL we hand back. Supports every provider in
  // the backend's OAUTH_PROVIDERS registry (Gmail, Slack, GitHub, Notion,
  // Linear as of Phase A). Returns 503 NOT_CONFIGURED if the provider's
  // client_id / client_secret env vars aren't set on the deployment.
  oauthAuthorize: (provider: string) =>
    apiDataFetch<{ authUrl: string; state: string; provider: string }>(
      `/integrations/oauth/${provider}/authorize`,
      { method: 'POST' },
    ),

  // List which providers have an OAuth implementation configured on THIS
  // deployment (both client_id and client_secret present). Used by the
  // ConnectModal to decide whether to render "Sign in with X" or fall back
  // to the credential-paste form.
  listOAuthProviders: () =>
    apiDataFetch<Array<{ id: string; label: string; configured: boolean }>>(
      '/integrations/oauth/providers',
    ),
};

export const whatsappApi = {
  getNumber: () => apiDataFetch<{ number: string | null; status: string; verificationCode?: string | null; expiresAt?: string | null; verifiedAt?: string | null }>('/whatsapp/number'),
  setNumber: (number: string) => apiDataFetch<{ number: string; status: string; verificationCode?: string | null; expiresAt?: string | null; verifiedAt?: string | null }>(
    '/whatsapp/number',
    { method: 'POST', body: { number } },
  ),
  clearNumber: () => apiDataFetch<void>('/whatsapp/number', { method: 'DELETE' }),
};

export const onboardingApi = {
  getState: () =>
    apiDataFetch<{ completedSteps: string[]; dismissed: boolean }>('/onboarding/state'),
  updateState: (body: { completedSteps?: string[]; dismissed?: boolean }) =>
    apiDataFetch<{ completedSteps: string[]; dismissed: boolean }>('/onboarding/state', { method: 'POST', body }),
};

export const approvalsApi = {
  list: (params?: { status?: string }) => {
    const qs = params?.status ? `?status=${params.status}` : '';
    return apiClient.get<unknown>(`/approvals${qs}`);
  },
  get: (id: string) => apiClient.get<unknown>(`/approvals/${id}`),
  decide: (id: string, body: { decision: string; comment?: string }) =>
    apiClient.post<unknown>(`/approvals/${id}/decide`, body),
};

export const adminApi = {
  /** GET /tenants/current/settings */
  getSettings: () => apiDataFetch<unknown>('/tenants/current/settings'),
  updateSettings: (settings: unknown) =>
    apiDataFetch<unknown>('/tenants/current/settings', { method: 'PATCH', body: settings }),

  /** GET /tenants/current/users */
  listUsers: () => apiDataFetch<unknown>('/tenants/current/users'),

  /** Skills (via /skills routes) */
  listSkills: (status?: string) =>
    apiClient.get<unknown>(`/skills${status ? `?status=${status}` : ''}`),
  approveSkill: (id: string) => apiClient.post<unknown>(`/skills/${id}/approve`, {}),
  rejectSkill: (id: string, reason: string) =>
    apiClient.post<unknown>(`/skills/${id}/reject`, { reason }),

  /** Tools */
  listTools: () => apiDataFetch<unknown>('/tools'),
};

// ─── Audit & Compliance v0 ─────────────────────────────────────────────
//
// Wraps GET /audit/log, /audit/workflows/:id/trail, /audit/reviewer-queue,
// /audit/dashboard. All routes are tenant-scoped server-side; the client
// just passes the bearer token. Returns are wrapped in `{success, data}`
// envelopes by `apiDataFetch` (which unwraps `data`).

export interface AuditLogEntry {
  id: string;
  tenantId: string;
  userId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  severity: string;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface WorkflowTrailEvent {
  at: string;
  source: 'lifecycle' | 'trace' | 'approval' | 'artifact';
  type: string;
  details: Record<string, unknown>;
}

export interface WorkflowTrail {
  workflow: { id: string; goal: string; status: string; startedAt: string; completedAt: string | null; totalCostUsd: number };
  events: WorkflowTrailEvent[];
  eventCount: number;
}

export interface ReviewerQueue {
  workflowApprovals: { items: ApprovalRequest[]; total: number };
  artifactApprovals: {
    items: Array<{
      id: string;
      workflowId: string;
      fileName: string;
      artifactType: string;
      sizeBytes: number | null;
      producedBy: string;
      createdAt: string;
    }>;
    total: number;
  };
  limit: number;
  offset: number;
}

export interface AuditDashboard {
  generatedAt: string;
  windows: { day: string; week: string };
  workflows: {
    total: number;
    byStatus: Array<{ status: string; count: number }>;
    last24h: number;
    last7d: number;
  };
  approvals: { byStatus: Array<{ status: string; count: number }> };
  artifacts: {
    available: boolean;
    byType: Array<{ artifactType: string; count: number }>;
    byApprovalState: Array<{ approvalState: string; count: number }>;
    signedBundles: number;
  };
  actionsLast7d: Array<{ action: string; count: number }>;
}

export const auditApi = {
  log: (params?: { limit?: number; offset?: number; action?: string; resource?: string; resourceId?: string; userId?: string; from?: string; to?: string; q?: string }) => {
    const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString() : '';
    return apiDataFetch<AuditLogPage>(`/audit/log${qs}`);
  },
  workflowTrail: (workflowId: string) =>
    apiDataFetch<WorkflowTrail>(`/audit/workflows/${workflowId}/trail`),
  reviewerQueue: (params?: { limit?: number; offset?: number; riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' }) => {
    const qs = params
      ? '?' + new URLSearchParams(
          Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== null && String(v).length > 0)
            .map(([k, v]) => [k, String(v)]),
        ).toString()
      : '';
    return apiDataFetch<ReviewerQueue>(`/audit/reviewer-queue${qs}`);
  },
  dashboard: () => apiDataFetch<AuditDashboard>('/audit/dashboard'),
};

// ─── Audit & Compliance v1 ─────────────────────────────────────────────
//
// Wraps /compliance/* — control framework mapping (SOC 2 Type 2 etc.).
// Built on top of the Audit & Compliance v0 audit log + reviewer surfaces.

export interface ComplianceFramework {
  slug: string;
  name: string;
  shortName: string;
  issuer: string;
  description: string;
  version: string;
}

export interface ComplianceSubControl {
  code: string;
  title: string;
  description: string;
}

export interface ComplianceControl {
  id: string;
  code: string;
  category: string;
  series: string;
  title: string;
  description: string;
  autoRuleKey: string | null;
  subControls: ComplianceSubControl[] | null;
  evidenceCount: number;
}

export interface ComplianceFrameworkSummary {
  framework: ComplianceFramework & { id: string };
  controls: ComplianceControl[];
  coverageCounts: { total: number; covered: number; uncovered: number; coveragePercent: number };
}

export interface ControlEvidenceItem {
  id: string;
  evidenceType: 'audit_log' | 'workflow' | 'approval' | 'artifact' | 'evidence_bundle';
  evidenceId: string;
  evidenceAt: string;
  mappedBy: string;
  mappingSource: 'auto' | 'manual';
  notes: string | null;
  createdAt: string;
}

export interface AutoMapResultClient {
  tenantId: string;
  frameworkSlug: string;
  periodStart: string;
  periodEnd: string;
  controlsProcessed: number;
  controlsWithRule: number;
  controlsWithoutRule: number;
  newMappingsCreated: number;
  totalEvidenceConsidered: number;
  perControl: Array<{ controlCode: string; ruleKey: string | null; created: number; total: number }>;
  durationMs: number;
}

export interface AttestationResultClient {
  attestationId: string;
  artifactId: string;
  bundleArtifactId?: string;
  bundleSignature?: string;
  framework: { slug: string; name: string; version: string };
  periodStart: string;
  periodEnd: string;
  totalEvidence: number;
  coveragePercent: number;
  controlSummary: Array<{ controlCode: string; title: string; evidenceCount: number }>;
  fileName: string;
}

export interface AttestationListItem {
  id: string;
  frameworkSlug: string;
  frameworkName: string;
  periodStart: string;
  periodEnd: string;
  totalEvidence: number;
  coveragePercent: number;
  artifactId: string | null;
  generatedBy: string;
  createdAt: string;
}

export const complianceApi = {
  listFrameworks: () =>
    apiDataFetch<{ frameworks: ComplianceFramework[] }>('/compliance/frameworks'),
  framework: (slug: string, params?: { from?: string; to?: string }) => {
    const qs = params
      ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v).map(([k, v]) => [k, String(v)])).toString()
      : '';
    return apiDataFetch<ComplianceFrameworkSummary>(`/compliance/frameworks/${slug}${qs}`);
  },
  controlEvidence: (slug: string, controlId: string, params?: { from?: string; to?: string; limit?: number; offset?: number }) => {
    const qs = params
      ? '?' + new URLSearchParams(
          Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== null && String(v).length > 0)
            .map(([k, v]) => [k, String(v)]),
        ).toString()
      : '';
    return apiDataFetch<{ items: ControlEvidenceItem[]; total: number; limit: number; offset: number }>(
      `/compliance/frameworks/${slug}/controls/${controlId}/evidence${qs}`,
    );
  },
  autoMap: (slug: string, body?: { periodStart?: string; periodEnd?: string }) =>
    apiDataFetch<AutoMapResultClient>(`/compliance/frameworks/${slug}/auto-map`, { method: 'POST', body: body ?? {} }),
  generateAttestation: (slug: string, body: { periodStart: string; periodEnd: string; sign?: boolean; metadata?: Record<string, unknown> }) =>
    apiDataFetch<AttestationResultClient>(`/compliance/frameworks/${slug}/attestations`, { method: 'POST', body }),
  listAttestations: (params?: { framework?: string; limit?: number; offset?: number }) => {
    const qs = params
      ? '?' + new URLSearchParams(
          Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== null && String(v).length > 0)
            .map(([k, v]) => [k, String(v)]),
        ).toString()
      : '';
    return apiDataFetch<{ items: AttestationListItem[]; total: number }>(`/compliance/attestations${qs}`);
  },
  // Manual evidence — human-curated rows that supplement the auto-mapper
  createManualEvidence: (body: { controlId: string; title: string; description: string; attachedArtifactId?: string; evidenceAt?: string }) =>
    apiDataFetch<{ id: string; mappingId: string }>('/compliance/manual-evidence', { method: 'POST', body }),
  listManualEvidence: (controlId: string, params?: { limit?: number; offset?: number }) => {
    const qs = params
      ? '?' + new URLSearchParams(
          Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== null && String(v).length > 0)
            .map(([k, v]) => [k, String(v)]),
        ).toString()
      : '';
    return apiDataFetch<{ items: Array<{ id: string; title: string; description: string; attachedArtifactId: string | null; createdBy: string; evidenceAt: string; createdAt: string }>; total: number }>(`/compliance/controls/${controlId}/manual-evidence${qs}`);
  },
  deleteManualEvidence: (id: string) =>
    apiDataFetch<{ deleted: boolean; id: string }>(`/compliance/manual-evidence/${id}`, { method: 'DELETE' }),
  // Scheduled attestations — recurring auto-generation
  listSchedules: () =>
    apiDataFetch<{ items: Array<ScheduledAttestationItem> }>('/compliance/schedules'),
  createSchedule: (body: { frameworkSlug: string; cronExpression: string; windowDays: number; signBundles: boolean; active?: boolean; metadata?: Record<string, unknown> }) =>
    apiDataFetch<{ schedule: ScheduledAttestationItem }>('/compliance/schedules', { method: 'POST', body }),
  updateSchedule: (id: string, body: { cronExpression?: string; windowDays?: number; signBundles?: boolean; active?: boolean; metadata?: Record<string, unknown> }) =>
    apiDataFetch<{ schedule: ScheduledAttestationItem }>(`/compliance/schedules/${id}`, { method: 'PATCH', body }),
  deleteSchedule: (id: string) =>
    apiDataFetch<{ deleted: boolean; id: string }>(`/compliance/schedules/${id}`, { method: 'DELETE' }),
};

// ─── Audit & Compliance v2 — engagement runs ───────────────────────────
//
// Wraps /audit/runs/* — full audit engagements with control tests,
// exceptions, workpapers, reviewer approval, signed final pack.
// Built on top of the v1 framework mapping + v0 audit log surfaces.

export type AuditRunStatusClient =
  | 'PLANNING' | 'PLANNED' | 'MAPPING' | 'TESTING' | 'REVIEWING'
  | 'READY_TO_PACK' | 'FINAL_PACK' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface AuditRunSummary {
  id: string;
  tenantId: string;
  userId: string;
  frameworkSlug: string;
  title: string;
  scope: string | null;
  periodStart: string;
  periodEnd: string;
  status: AuditRunStatusClient;
  riskSummary: 'low' | 'medium' | 'high' | 'critical' | null;
  coveragePercent: number | null;
  finalPackArtifactId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ControlTestRow {
  id: string;
  controlId: string;
  controlCode: string;
  controlTitle: string;
  testProcedure: string | null;
  status: string;
  result: 'pass' | 'fail' | 'exception' | 'needs_evidence' | null;
  rationale: string | null;
  confidence: number | null;
  evidenceCount: number;
  exceptionId: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AuditExceptionRow {
  id: string;
  controlId: string;
  controlCode: string;
  controlTestId: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: string;
  description: string;
  cause: string | null;
  impact: string | null;
  remediationPlan: string | null;
  remediationOwner: string | null;
  remediationDueDate: string | null;
  reviewerStatus: string | null;
  reviewerComment: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface AuditWorkpaperRow {
  id: string;
  controlId: string;
  controlCode: string;
  controlTitle: string;
  controlTestId: string | null;
  artifactId: string | null;
  status: 'draft' | 'needs_evidence' | 'needs_review' | 'rejected' | 'approved' | 'final';
  reviewerNotes: string | null;
  generatedBy: string;
  reviewedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface AuditRunDetail {
  run: AuditRunSummary;
  controlTests: ControlTestRow[];
  exceptions: AuditExceptionRow[];
  workpapers: AuditWorkpaperRow[];
}

export interface FinalPackResultClient {
  artifactId: string;
  signature: string;
  signatureAlgo: string;
  manifest: { version: number; tenantId: string; workflowId: string; generatedAt: string; artifacts: Array<{ artifactId: string; fileName: string; contentHash: string; sizeBytes: number; artifactType: string }>; metadata?: Record<string, unknown> };
  workpaperCount: number;
  exceptionCount: number;
  controlCount: number;
}

export const auditRunsApi = {
  list: (params?: { status?: string; limit?: number; offset?: number }) => {
    const qs = params
      ? '?' + new URLSearchParams(
          Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== null && String(v).length > 0)
            .map(([k, v]) => [k, String(v)]),
        ).toString()
      : '';
    return apiDataFetch<{ items: AuditRunSummary[]; total: number; limit: number; offset: number }>(`/audit/runs${qs}`);
  },
  get: (id: string) =>
    apiDataFetch<AuditRunDetail>(`/audit/runs/${id}`),
  create: (body: { frameworkSlug: string; title: string; scope?: string; periodStart: string; periodEnd: string; metadata?: Record<string, unknown> }) =>
    apiDataFetch<{ id: string; status: AuditRunStatusClient }>('/audit/runs', { method: 'POST', body }),
  plan: (id: string) =>
    apiDataFetch<{ controlsSeeded: number }>(`/audit/runs/${id}/plan`, { method: 'POST', body: {} }),
  autoMap: (id: string) =>
    apiDataFetch<AutoMapResultClient>(`/audit/runs/${id}/auto-map`, { method: 'POST', body: {} }),
  testControls: (id: string, body?: { limit?: number }) =>
    apiDataFetch<{ totalTests: number; ranTests: number; passed: number; failed: number; exceptions: number; needsEvidence: number; durationMs: number }>(`/audit/runs/${id}/test-controls`, { method: 'POST', body: body ?? {} }),
  testSingle: (id: string, controlTestId: string) =>
    apiDataFetch<{ result: 'pass' | 'fail' | 'exception' | 'needs_evidence' }>(`/audit/runs/${id}/controls/${controlTestId}/test`, { method: 'POST', body: {} }),
  generateWorkpapers: (id: string, body?: { forceRegenerate?: boolean }) =>
    apiDataFetch<{ totalControls: number; generated: number; skipped: number; failed: number; durationMs: number }>(`/audit/runs/${id}/workpapers/generate`, { method: 'POST', body: body ?? {} }),
  decideWorkpaper: (id: string, wpId: string, body: { decision: 'approved' | 'rejected'; reviewerNotes?: string }) =>
    apiDataFetch<AuditWorkpaperRow>(`/audit/runs/${id}/workpapers/${wpId}/decide`, { method: 'POST', body }),
  createException: (id: string, body: { controlId: string; controlCode: string; severity: 'low' | 'medium' | 'high' | 'critical'; description: string; cause?: string; impact?: string; remediationPlan?: string; remediationOwner?: string; remediationDueDate?: string }) =>
    apiDataFetch<{ id: string; status: string }>(`/audit/runs/${id}/exceptions`, { method: 'POST', body }),
  updateRemediation: (id: string, exId: string, body: { remediationPlan?: string; remediationOwner?: string; remediationDueDate?: string }) =>
    apiDataFetch<AuditExceptionRow>(`/audit/runs/${id}/exceptions/${exId}/remediation`, { method: 'PATCH', body }),
  decideException: (id: string, exId: string, body: { to: 'accepted' | 'rejected' | 'closed' | 'remediation_planned' | 'remediation_in_progress' | 'remediation_complete'; reviewerComment?: string }) =>
    apiDataFetch<AuditExceptionRow>(`/audit/runs/${id}/exceptions/${exId}/decide`, { method: 'POST', body }),
  finalPack: (id: string) =>
    apiDataFetch<FinalPackResultClient>(`/audit/runs/${id}/final-pack`, { method: 'POST', body: {} }),
  delete: (id: string) =>
    apiDataFetch<void>(`/audit/runs/${id}`, { method: 'DELETE' }),
};

// ─── Company Brain (Migration 16) ──────────────────────────────────────
//
// CompanyProfile + IntentRecord + Memory approval + WorkflowTemplate.
// All tenant-scoped via the JWT (server reads tenantId from request.user).

export type CompanyProfileStatus = 'extracted' | 'user_approved' | 'manual';

export interface CompanyProfileClient {
  id: string;
  tenantId: string;
  name: string | null;
  industry: string | null;
  description: string | null;
  productsServices: Array<{ name: string; description?: string }> | null;
  targetCustomers: string | null;
  brandVoice: string | null;
  competitors: Array<{ name: string; url?: string; notes?: string }> | null;
  pricing: string | null;
  websiteUrl: string | null;
  goals: string | null;
  constraints: string | null;
  preferredChannels: string[] | null;
  status: CompanyProfileStatus;
  extractionConfidence: number | null;
  sourceDocumentIds: string[] | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyProfileFields {
  name?: string;
  industry?: string;
  description?: string;
  productsServices?: Array<{ name: string; description?: string }>;
  targetCustomers?: string;
  brandVoice?: string;
  competitors?: Array<{ name: string; url?: string; notes?: string }>;
  pricing?: string;
  websiteUrl?: string;
  goals?: string;
  constraints?: string;
  preferredChannels?: string[];
}

export interface IntentRecordClient {
  id: string;
  tenantId: string;
  workflowId: string | null;
  userId: string;
  rawInput: string;
  intent: string;
  intentConfidence: number | null;
  subFunction: string | null;
  urgency: number | null;
  workflowTemplateId: string | null;
  clarificationNeeded: boolean;
  clarificationQuestion: string | null;
  directAnswer: string | null;
  createdAt: string;
}

export interface WorkflowTemplateClient {
  id: string;
  tenantId: string | null;
  intent: string;
  name: string;
  description: string;
  tasksJson: unknown;
  requiredCompanyContext: string[] | null;
  requiredUserInputs: string[] | null;
  approvalGates: string[] | null;
  expectedArtifacts: string[] | null;
  status: string;
}

export const companyBrainApi = {
  getProfile: () =>
    apiDataFetch<{ profile: CompanyProfileClient | null }>('/company/profile'),
  saveManualProfile: (fields: CompanyProfileFields) =>
    apiDataFetch<{ profile: CompanyProfileClient }>('/company/profile/manual', { method: 'POST', body: fields }),
  extractProfile: (body?: { documentIds?: string[] }) =>
    apiDataFetch<{ profile: CompanyProfileClient }>('/company/profile/extract', { method: 'POST', body: body ?? {} }),
  approveProfile: (body?: { edits?: CompanyProfileFields }) =>
    apiDataFetch<{ profile: CompanyProfileClient }>('/company/profile/approve', { method: 'POST', body: body ?? {} }),
  rejectProfile: () =>
    apiDataFetch<void>('/company/profile', { method: 'DELETE' }),
  listIntents: (params?: { intent?: string; userId?: string; limit?: number; offset?: number }) => {
    const qs = params
      ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()
      : '';
    return apiDataFetch<{ items: IntentRecordClient[]; total: number; limit: number; offset: number }>(`/intents${qs}`);
  },
  intentStats: () =>
    apiDataFetch<{ stats: Array<{ intent: string; count: number }> }>('/intents/stats'),
  listPendingMemory: (params?: { limit?: number; offset?: number }) => {
    const qs = params
      ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()
      : '';
    return apiDataFetch<{ items: Array<{ id: string; key: string; value: unknown; memoryType: string; status: string; suggestedBy: string | null; createdAt: string }>; total: number }>(`/memory/pending${qs}`);
  },
  approveMemory: (id: string) =>
    apiDataFetch<{ approved: boolean; id: string }>(`/memory/${id}/approve`, { method: 'POST', body: {} }),
  rejectMemory: (id: string, reason?: string) =>
    apiDataFetch<{ rejected: boolean; id: string }>(`/memory/${id}/reject`, { method: 'POST', body: { reason } }),
  listTemplates: (intent?: string) => {
    const qs = intent ? `?intent=${encodeURIComponent(intent)}` : '';
    return apiDataFetch<{ items: WorkflowTemplateClient[] }>(`/workflow-templates${qs}`);
  },
  templateForIntent: (intent: string) =>
    apiDataFetch<{ template: WorkflowTemplateClient }>(`/workflow-templates/by-intent/${encodeURIComponent(intent)}`),
};

// ─── SYSTEM_ADMIN cross-tenant aggregate views ─────────────────────────
//
// Separate surface from /audit/* (tenant-scoped). Only SYSTEM_ADMIN
// users can call these — the API enforces it.

export interface AdminOverview {
  generatedAt: string;
  tenants: { total: number; byStatus: Array<{ status: string; count: number }> };
  users: { total: number };
  workflows: {
    total: number;
    byStatus: Array<{ status: string; count: number }>;
    last24h: number;
    last7d: number;
    last30d: number;
    totalCostUsd: number;
  };
  auditLog: { total: number; last24h: number };
  compliance: { attestationsTotal: number; activeSchedules: number };
}

export interface AdminTenantRow {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  status: string;
  createdAt: string;
  workflowCount: number;
  approvalCount: number;
  attestationCount: number;
  evidenceMappingCount: number;
}

export interface AdminFrameworkRollup {
  slug: string;
  name: string;
  version: string;
  totalControls: number;
  tenantsWithEvidence: number;
  totalEvidenceMappings: number;
  attestationsGenerated: number;
}

export const adminAggregateApi = {
  overview: () => apiDataFetch<AdminOverview>('/admin/aggregate/overview'),
  tenants: (params?: { limit?: number; offset?: number }) => {
    const qs = params
      ? '?' + new URLSearchParams(
          Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== null && String(v).length > 0)
            .map(([k, v]) => [k, String(v)]),
        ).toString()
      : '';
    return apiDataFetch<{ items: AdminTenantRow[]; total: number; limit: number; offset: number }>(`/admin/aggregate/tenants${qs}`);
  },
  compliance: () => apiDataFetch<{ frameworks: AdminFrameworkRollup[] }>('/admin/aggregate/compliance'),
};

export interface ScheduledAttestationItem {
  id: string;
  tenantId: string;
  frameworkId: string;
  frameworkSlug?: string;
  frameworkName?: string;
  cronExpression: string;
  windowDays: number;
  signBundles: boolean;
  active: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastAttestationId: string | null;
  createdBy: string;
  createdAt: string;
}

export const apiKeyApi = {
  /** GET /tenants/current/api-keys */
  list: () => apiDataFetch<unknown[]>('/tenants/current/api-keys'),

  /**
   * POST /tenants/current/api-keys
   * Returns { ...key, key: '<rawKey>' } — the raw key is returned only once.
   */
  create: (body: { name: string; scopes?: string[]; expiresAt?: string }) =>
    apiDataFetch<{ id: string; name: string; scopes: string[]; expiresAt: string | null; createdAt: string; key: string }>(
      '/tenants/current/api-keys',
      { method: 'POST', body },
    ),

  /** DELETE /tenants/current/api-keys/:keyId */
  revoke: (keyId: string) =>
    apiDataFetch<void>(`/tenants/current/api-keys/${keyId}`, { method: 'DELETE' }),
};

export const toolToggleApi = {
  /**
   * PATCH /tenants/current/tools/:toolName
   * Enable or disable a specific tool for this tenant.
   */
  toggle: (toolName: string, enabled: boolean) =>
    apiDataFetch<{ toolName: string; enabled: boolean; disabledToolNames: string[] }>(
      `/tenants/current/tools/${encodeURIComponent(toolName)}`,
      { method: 'PATCH', body: { enabled } },
    ),
};

// ─── Schedule API ────────────────────────────────────────────────────────────

export const scheduleApi = {
  list: () => apiClient.get<unknown>('/schedules'),
  get: (id: string) => apiClient.get<unknown>(`/schedules/${id}`),
  create: (body: { name: string; goal: string; cronExpression: string; description?: string; industry?: string; maxCostUsd?: number }) =>
    apiClient.post<unknown>('/schedules', body),
  update: (id: string, body: Record<string, unknown>) =>
    apiClient.patch<unknown>(`/schedules/${id}`, body),
  delete: (id: string) => apiClient.delete<unknown>(`/schedules/${id}`),
  runNow: (id: string) => apiClient.post<unknown>(`/schedules/${id}/run`),
};

// ─── Projects (Vibe Coding) ─────────────────────────────────────────

export const projectApi = {
  list: (params?: { page?: number; status?: string }) =>
    apiClient.get<unknown>(`/projects${params ? `?${new URLSearchParams(params as Record<string, string>).toString()}` : ''}`),
  get: (id: string) => apiClient.get<unknown>(`/projects/${id}`),
  create: (body: { name: string; description?: string; framework?: string; templateId?: string }) =>
    apiClient.post<unknown>('/projects', body),
  generate: (id: string, body: { description: string; framework?: string; templateId?: string; imageBase64?: string }) =>
    apiClient.post<unknown>(`/projects/${id}/generate`, body),
  iterate: (id: string, body: { message: string; imageBase64?: string }) =>
    apiClient.post<unknown>(`/projects/${id}/iterate`, body),
  deploy: (id: string) =>
    apiClient.post<unknown>(`/projects/${id}/deploy`),
  rollback: (id: string, version: number) =>
    apiClient.post<unknown>(`/projects/${id}/rollback`, { version }),
  files: (id: string) => apiClient.get<unknown>(`/projects/${id}/files`),
  updateFile: (id: string, path: string, content: string) =>
    apiClient.put<unknown>(`/projects/${id}/files/${path}`, { content }),
  versions: (id: string) => apiClient.get<unknown>(`/projects/${id}/versions`),
  conversations: (id: string) => apiClient.get<unknown>(`/projects/${id}/conversations`),
  delete: (id: string) => apiClient.delete<unknown>(`/projects/${id}`),

  // ─── Checkpoints (diff-aware revert, replaces rollback/versions for new UI) ───
  // Each of these unwraps the `{success, data}` envelope via apiDataFetch so
  // consumers get a typed value directly (no `res.data` gymnastics).
  listCheckpoints: (id: string, limit?: number) =>
    apiDataFetch<Checkpoint[]>(`/projects/${id}/checkpoints${limit ? `?limit=${limit}` : ''}`),
  getCheckpoint: (id: string, version: number) =>
    apiDataFetch<CheckpointDetail>(`/projects/${id}/checkpoints/${version}`),
  createCheckpoint: (id: string, body?: { description?: string; stage?: string; workflowId?: string }) =>
    apiDataFetch<Checkpoint>(`/projects/${id}/checkpoints`, { method: 'POST', body: body ?? {} }),
  restoreCheckpoint: (id: string, version: number) =>
    apiDataFetch<Checkpoint>(`/projects/${id}/checkpoints/${version}/restore`, { method: 'POST', body: {} }),
};

// ─── Checkpoint types (mirror CheckpointService output shape) ───────────
export type CheckpointStage = 'architect' | 'generator' | 'debugger' | 'deployer' | 'manual' | 'rollback';

export interface CheckpointDiffEntry {
  path: string;
  prevSize?: number;
  nextSize?: number;
  prevHash?: string;
  nextHash?: string;
}

export interface CheckpointDiff {
  added: CheckpointDiffEntry[];
  modified: CheckpointDiffEntry[];
  deleted: CheckpointDiffEntry[];
  totalFiles: number;
  hasChanges: boolean;
}

export interface Checkpoint {
  id: string;
  version: number;
  description: string | null;
  stage: CheckpointStage | null;
  workflowId: string | null;
  createdBy: string;
  createdAt: string;
  diff: CheckpointDiff | null;
}

export interface CheckpointDetail extends Checkpoint {
  snapshot: Array<{ path: string; content: string; language: string | null }>;
}

// ─── Usage & Billing ──────────────────────────────────────────────────

export const usageApi = {
  /** Current credit balance and limits */
  getUsage: () => apiDataFetch<{
    plan: string;
    credits: { used: number; total: number; remaining: number };
    premium: { used: number; total: number; remaining: number };
    daily: { used: number; cap: number; remaining: number; resetsAt: string };
    monthly: { resetsAt: string };
    perTaskCap: number;
    maxModelTier: number;
  }>('/usage'),

  /** Recent usage history */
  getHistory: (params?: { limit?: number; offset?: number }) => {
    const qs = params ? `?${new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))).toString()}` : '';
    return apiDataFetch<{ entries: Array<{ id: string; taskType: string; modelUsed: string; creditsCost: number; status: string; createdAt: string }>; total: number }>(`/usage/history${qs}`);
  },

  /** Pre-execution cost estimate */
  estimate: (goal: string) => apiDataFetch<{
    taskType: string;
    estimatedCredits: number;
    model: string;
    tier: number;
    canAfford: boolean;
    remaining: { daily: number; monthly: number };
    message: string;
  }>('/usage/estimate', { method: 'POST', body: { goal } }),
};
