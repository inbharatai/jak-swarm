import type { ApiError, Integration } from '@/types';
import { createClient } from './supabase';

const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

async function getToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

function clearSession(): void {
  if (typeof window === 'undefined') return;
  const supabase = createClient();
  supabase.auth.signOut();
  window.location.href = '/login';
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
    const error: ApiError = {
      message: json?.message ?? response.statusText ?? 'Request failed',
      code: json?.code ?? 'UNKNOWN_ERROR',
      status: response.status,
      details: json?.details,
    };
    throw error;
  }

  return json as T;
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

/** Generic fetch helper for use in components */
export function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const method = options?.method ?? 'GET';
  const body = options?.body ? JSON.parse(options.body as string) : undefined;
  return request<T>(method, path, body);
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
    return apiClient.get<unknown>(`/workflows${qs}`);
  },

  /** GET /workflows/:id */
  get: (id: string) => apiClient.get<unknown>(`/workflows/${id}`),

  /**
   * POST /workflows — returns 202 Accepted immediately.
   * Use workflowApi.get() to poll for status changes.
   */
  create: (goal: string, industry?: string) =>
    apiClient.post<unknown>('/workflows', { goal, industry }),

  /**
   * POST /workflows/:id/resume — send approval decision to resume a PAUSED workflow.
   * decision: 'APPROVED' | 'REJECTED' | 'DEFERRED'
   */
  resume: (id: string, decision: 'APPROVED' | 'REJECTED' | 'DEFERRED', comment?: string) =>
    apiClient.post<unknown>(`/workflows/${id}/resume`, { decision, comment }),

  /** DELETE /workflows/:id — cancel a running workflow */
  cancel: (id: string) => apiClient.delete<unknown>(`/workflows/${id}`),

  /** Pause a running workflow (pauses between nodes) */
  pause: (id: string) => apiClient.post<unknown>(`/workflows/${id}/pause`),

  /** Resume a paused workflow */
  unpause: (id: string) => apiClient.post<unknown>(`/workflows/${id}/unpause`),

  /** Alias: stop = cancel, stopAll is a no-op (cancel each separately) */
  stop: (id: string) => apiClient.post<unknown>(`/workflows/${id}/stop`),
  stopAll: () => Promise.resolve(null),

  /** GET /workflows/:id/traces */
  traces: (id: string) => apiClient.get<unknown>(`/workflows/${id}/traces`),

  /** GET /workflows/:id/approvals */
  approvals: (id: string) => apiClient.get<unknown>(`/workflows/${id}/approvals`),
};

export const approvalApi = {
  /** GET /approvals?status=PENDING */
  list: (status?: string) =>
    apiClient.get<unknown>(`/approvals${status ? `?status=${status}` : ''}`),

  /** GET /approvals/:id */
  get: (id: string) => apiClient.get<unknown>(`/approvals/${id}`),

  /**
   * POST /approvals/:id/decide — unified decision endpoint.
   * decision: 'APPROVED' | 'REJECTED' | 'DEFERRED'
   */
  decide: (id: string, decision: 'APPROVED' | 'REJECTED' | 'DEFERRED', comment?: string) =>
    apiClient.post<unknown>(`/approvals/${id}/decide`, { decision, comment }),

  approve: (id: string, comment?: string) =>
    apiClient.post<unknown>(`/approvals/${id}/decide`, { decision: 'APPROVED', comment }),

  reject: (id: string, comment?: string) =>
    apiClient.post<unknown>(`/approvals/${id}/decide`, { decision: 'REJECTED', comment }),

  /** POST /approvals/:id/defer */
  defer: (id: string, comment?: string) =>
    apiClient.post<unknown>(`/approvals/${id}/defer`, { comment }),
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
    return apiClient.get<unknown>(`/memory${qs}`);
  },

  /** POST /memory */
  create: (entry: { type: string; key: string; value: unknown; ttl?: number; expiresAt?: string }) =>
    apiClient.post<unknown>('/memory', entry),

  /** PATCH /memory/:id */
  update: (id: string, value: unknown) =>
    apiClient.patch<unknown>(`/memory/${id}`, { value }),

  /** DELETE /memory/:id */
  delete: (id: string) => apiClient.delete<unknown>(`/memory/${id}`),
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

  /** POST /skills — propose a new skill */
  propose: (skill: Record<string, unknown>) => apiClient.post<unknown>('/skills', skill),

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
  list: () => apiClient.get<{ data: Integration[] }>('/integrations').then(r => r.data),
  disconnect: (id: string) => apiClient.delete<void>(`/integrations/${id}`),
  connect: (provider: string, credentials: Record<string, string>) =>
    apiFetch<{ id: string; provider: string; status: string; toolsRegistered: string[] }>(
      '/integrations/connect',
      { method: 'POST', body: JSON.stringify({ provider, credentials }) },
    ),
  getProviderInfo: (provider: string) =>
    apiFetch<{ name: string; description: string; credentialFields: Array<{ key: string; label: string; placeholder: string; type: string; helpUrl?: string }>; setupInstructions: string }>(
      `/integrations/providers/${provider}`,
    ),
  test: (id: string) =>
    apiFetch<{ connected: boolean; toolCount: number; tools: string[] }>(
      `/integrations/${id}/test`,
      { method: 'POST' },
    ),
};

export const onboardingApi = {
  getState: () =>
    apiClient.get<{ data: { completedSteps: string[]; dismissed: boolean } }>('/onboarding/state').then(r => r.data),
  updateState: (body: { completedSteps?: string[]; dismissed?: boolean }) =>
    apiClient.post<{ data: { completedSteps: string[]; dismissed: boolean } }>('/onboarding/state', body).then(r => r.data),
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
  /** GET /tenants/:tenantId/settings (use current tenant from token) */
  getSettings: () => apiClient.get<unknown>('/tenants/current/settings'),
  updateSettings: (settings: unknown) =>
    apiClient.patch<unknown>('/tenants/current/settings', settings),

  /** GET /tenants/:tenantId/users */
  listUsers: () => apiClient.get<unknown>('/tenants/current/users'),
  updateUserRole: (userId: string, role: string) =>
    apiClient.patch<unknown>(`/tenants/current/users/${userId}`, { role }),

  /** Skills (via /skills routes) */
  listSkills: (status?: string) =>
    apiClient.get<unknown>(`/skills${status ? `?status=${status}` : ''}`),
  approveSkill: (id: string) => apiClient.post<unknown>(`/skills/${id}/approve`, {}),
  rejectSkill: (id: string, reason: string) =>
    apiClient.post<unknown>(`/skills/${id}/reject`, { reason }),

  /** API Keys — managed via tenants plugin */
  listApiKeys: () => apiClient.get<unknown>('/tenants/current/api-keys'),
  createApiKey: (name: string, permissions: string[]) =>
    apiClient.post<unknown>('/tenants/current/api-keys', { name, permissions }),
  deleteApiKey: (id: string) =>
    apiClient.delete<unknown>(`/tenants/current/api-keys/${id}`),

  /** Tools */
  listTools: () => apiClient.get<unknown>('/tools'),
  toggleTool: (toolId: string, enabled: boolean) =>
    apiClient.patch<unknown>(`/tools/${toolId}`, { enabled }),
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
