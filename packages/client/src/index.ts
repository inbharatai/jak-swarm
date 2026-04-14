/**
 * @jak-swarm/client — TypeScript SDK for JAK Swarm
 *
 * Provides programmatic access to JAK Swarm's API for:
 * - Workflow CRUD and execution
 * - Real-time streaming via SSE
 * - Memory read/write
 * - Tool and skill management
 *
 * Usage:
 * ```typescript
 * import { JakClient } from '@jak-swarm/client';
 *
 * const client = new JakClient({
 *   baseUrl: 'http://localhost:3001',
 *   apiKey: 'your-api-key',
 * });
 *
 * // Create and execute a workflow
 * const workflow = await client.workflows.create({
 *   goal: 'Research competitor pricing for Q2 report',
 *   industry: 'FINANCE',
 * });
 *
 * // Stream execution events
 * for await (const event of client.workflows.stream(workflow.id)) {
 *   console.log(event.type, event.data);
 * }
 *
 * // Read tenant memories
 * const memories = await client.memory.list();
 * ```
 */

export interface JakClientConfig {
  /** Base URL of the JAK Swarm API (e.g., http://localhost:3001) */
  baseUrl: string;
  /** API key or JWT token for authentication */
  apiKey?: string;
  /** Custom fetch implementation (for testing or Node.js < 18) */
  fetch?: typeof fetch;
  /** Default timeout in milliseconds (default: 30000) */
  timeout?: number;
}

export interface WorkflowCreateParams {
  goal: string;
  industry?: string;
  maxCostUsd?: number;
}

export interface Workflow {
  id: string;
  tenantId: string;
  userId: string;
  goal: string;
  status: string;
  industry?: string;
  totalCostUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowListParams {
  page?: number;
  limit?: number;
  status?: string;
}

export interface StreamEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface MemoryEntry {
  key: string;
  value: unknown;
  memoryType: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryUpsertParams {
  key: string;
  value: unknown;
  type?: 'FACT' | 'PREFERENCE' | 'CONTEXT' | 'SKILL_RESULT';
  ttl?: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeout: number;

  constructor(config: JakClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.fetchFn = config.fetch ?? globalThis.fetch;
    this.timeout = config.timeout ?? 30_000;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      h['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  async get<T>(path: string): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!res.ok) throw new JakApiError(res.status, await res.text());
    const body = await res.json() as ApiResponse<T>;
    if (!body.success) throw new JakApiError(res.status, body.error?.message ?? 'Unknown error');
    return body.data as T;
  }

  async post<T>(path: string, data?: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!res.ok) throw new JakApiError(res.status, await res.text());
    const body = await res.json() as ApiResponse<T>;
    if (!body.success) throw new JakApiError(res.status, body.error?.message ?? 'Unknown error');
    return body.data as T;
  }

  async put<T>(path: string, data?: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: 'PUT',
      headers: this.headers(),
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!res.ok) throw new JakApiError(res.status, await res.text());
    const body = await res.json() as ApiResponse<T>;
    if (!body.success) throw new JakApiError(res.status, body.error?.message ?? 'Unknown error');
    return body.data as T;
  }

  async delete(path: string): Promise<void> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!res.ok) throw new JakApiError(res.status, await res.text());
  }

  async *stream(path: string): AsyncGenerator<StreamEvent> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: {
        ...this.headers(),
        'Accept': 'text/event-stream',
      },
    });

    if (!res.ok) throw new JakApiError(res.status, await res.text());
    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let eventData = '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            eventData += line.slice(6);
          } else if (line === '' && eventData) {
            try {
              yield JSON.parse(eventData) as StreamEvent;
            } catch {
              // Skip malformed events
            }
            eventData = '';
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export class JakApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(`JAK API Error (${statusCode}): ${message}`);
    this.name = 'JakApiError';
  }
}

class WorkflowsClient {
  constructor(private readonly http: HttpClient) {}

  async create(params: WorkflowCreateParams): Promise<Workflow> {
    return this.http.post<Workflow>('/api/v1/workflows', params);
  }

  async get(workflowId: string): Promise<Workflow> {
    return this.http.get<Workflow>(`/api/v1/workflows/${encodeURIComponent(workflowId)}`);
  }

  async list(params?: WorkflowListParams): Promise<{ items: Workflow[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.status) query.set('status', params.status);
    const qs = query.toString();
    return this.http.get(`/api/v1/workflows${qs ? `?${qs}` : ''}`);
  }

  async cancel(workflowId: string): Promise<void> {
    await this.http.post(`/api/v1/workflows/${encodeURIComponent(workflowId)}/cancel`);
  }

  async approve(workflowId: string, approvalId: string, decision: 'APPROVED' | 'REJECTED', comment?: string): Promise<void> {
    await this.http.post(`/api/v1/workflows/${encodeURIComponent(workflowId)}/approve`, {
      approvalId,
      decision,
      comment,
    });
  }

  async *stream(workflowId: string): AsyncGenerator<StreamEvent> {
    yield* this.http.stream(`/api/v1/workflows/${encodeURIComponent(workflowId)}/events`);
  }

  async traces(workflowId: string): Promise<Array<Record<string, unknown>>> {
    return this.http.get(`/api/v1/workflows/${encodeURIComponent(workflowId)}/traces`);
  }
}

class MemoryClient {
  constructor(private readonly http: HttpClient) {}

  async list(params?: { type?: string; page?: number; limit?: number; search?: string }): Promise<{ items: MemoryEntry[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.type) query.set('type', params.type);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return this.http.get(`/api/v1/memory${qs ? `?${qs}` : ''}`);
  }

  async get(key: string): Promise<MemoryEntry> {
    return this.http.get(`/api/v1/memory/${encodeURIComponent(key)}`);
  }

  async upsert(params: MemoryUpsertParams): Promise<MemoryEntry> {
    return this.http.put(`/api/v1/memory/${encodeURIComponent(params.key)}`, {
      value: params.value,
      type: params.type ?? 'FACT',
      ttl: params.ttl,
    });
  }

  async delete(key: string): Promise<void> {
    await this.http.delete(`/api/v1/memory/${encodeURIComponent(key)}`);
  }
}

class HealthClient {
  constructor(private readonly http: HttpClient) {}

  async check(): Promise<Record<string, unknown>> {
    return this.http.get('/health');
  }
}

/**
 * JAK Swarm Client — TypeScript SDK for programmatic API access.
 *
 * Provides typed methods for workflows, memory, and streaming
 * without needing to construct HTTP requests manually.
 */
export class JakClient {
  readonly workflows: WorkflowsClient;
  readonly memory: MemoryClient;
  readonly health: HealthClient;

  constructor(config: JakClientConfig) {
    const http = new HttpClient(config);
    this.workflows = new WorkflowsClient(http);
    this.memory = new MemoryClient(http);
    this.health = new HealthClient(http);
  }
}
