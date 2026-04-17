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
    apiDataFetch<{ name: string; description: string; credentialFields: Array<{ key: string; label: string; placeholder: string; type: string; helpUrl?: string }>; setupInstructions: string }>(
      `/integrations/providers/${provider}`,
    ),
  test: (id: string) =>
    apiDataFetch<{ connected: boolean; toolCount: number; tools: string[] }>(
      `/integrations/${id}/test`,
      { method: 'POST' },
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
};

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
