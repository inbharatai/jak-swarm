'use client';

import useSWR, { type SWRConfiguration } from 'swr';
import { dataFetcher } from '@/lib/api-client';
import type {
  Workflow,
  WorkflowFilters,
  ApprovalRequest,
  PaginatedResult,
} from '@/types';

// ─── Fetcher ──────────────────────────────────────────────────────────────────

async function fetcher<T>(url: string): Promise<T> {
  return dataFetcher<T>(url);
}

// ─── Terminal statuses that don't need polling ────────────────────────────────
// These match the API-persisted WorkflowStatus values (always UPPERCASE).

const TERMINAL_STATUSES: Workflow['status'][] = ['COMPLETED', 'FAILED', 'CANCELLED'];

function isTerminal(workflow?: Workflow): boolean {
  return workflow ? TERMINAL_STATUSES.includes(workflow.status) : false;
}

// ─── useWorkflow ──────────────────────────────────────────────────────────────

interface UseWorkflowOptions {
  /** When true, disables polling (e.g. when SSE stream is connected). */
  disablePolling?: boolean;
}

export function useWorkflow(workflowId: string | null | undefined, options?: UseWorkflowOptions) {
  const { data, error, isLoading, mutate } = useSWR<Workflow>(
    workflowId ? `/workflows/${workflowId}` : null,
    fetcher,
    {
      refreshInterval: (data) => {
        // Stop polling once terminal
        if (isTerminal(data)) return 0;
        // Stop polling when SSE stream is providing live updates
        if (options?.disablePolling) return 0;
        return 2000; // Poll every 2s while running
      },
      revalidateOnFocus: !isTerminal(undefined),
    },
  );

  return {
    workflow: data,
    isLoading,
    error,
    refresh: mutate,
    isRunning: data ? !isTerminal(data) : false,
  };
}

// ─── useWorkflows ─────────────────────────────────────────────────────────────

export function useWorkflows(filters?: WorkflowFilters, config?: SWRConfiguration) {
  const params = new URLSearchParams();

  if (filters?.status?.length) {
    params.set('status', filters.status.join(','));
  }
  if (filters?.industry) params.set('industry', filters.industry);
  if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters?.dateTo) params.set('dateTo', filters.dateTo);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.page) params.set('page', String(filters.page));
  if (filters?.pageSize) params.set('limit', String(filters.pageSize));

  const qs = params.toString();
  const key = `/workflows${qs ? `?${qs}` : ''}`;

  const { data, error, isLoading, mutate } = useSWR<PaginatedResult<Workflow>>(
    key,
    fetcher,
    {
      refreshInterval: 10_000,
      ...config,
    },
  );

  return {
    workflows: data?.items ?? [],
    total: data?.total ?? 0,
    totalPages: data ? Math.ceil(data.total / data.limit) : 0,
    isLoading,
    error,
    refresh: mutate,
  };
}

// ─── useApprovals ─────────────────────────────────────────────────────────────

export function useApprovals(status: 'pending' | 'all' = 'pending') {
  const queryStatus = status === 'all' ? undefined : 'PENDING';
  const { data, error, isLoading, mutate } = useSWR<PaginatedResult<ApprovalRequest>>(
    `/approvals${queryStatus ? `?status=${queryStatus}` : ''}`,

    fetcher,
    {
      refreshInterval: 5_000, // Poll every 5s for new approvals
      revalidateOnFocus: true,
    },
  );

  return {
    approvals: data?.items ?? [],
    pendingCount: data?.items.filter(a => a.status === 'PENDING').length ?? 0,
    isLoading,
    error,
    refresh: mutate,
  };
}

// ─── useActiveWorkflows ───────────────────────────────────────────────────────

export function useActiveWorkflows() {
  return useWorkflows(
    { status: ['PENDING', 'RUNNING', 'PAUSED'] },
    { refreshInterval: 3_000 },
  );
}
