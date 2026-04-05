'use client';

import useSWR, { type SWRConfiguration } from 'swr';
import { apiClient } from '@/lib/api-client';
import type {
  Workflow,
  WorkflowFilters,
  ApprovalRequest,
  PaginatedResponse,
} from '@/types';

// ─── Fetcher ──────────────────────────────────────────────────────────────────

async function fetcher<T>(url: string): Promise<T> {
  return apiClient.get<T>(url);
}

// ─── Terminal statuses that don't need polling ────────────────────────────────
// These match the API-persisted WorkflowStatus values (always UPPERCASE).

const TERMINAL_STATUSES: Workflow['status'][] = ['COMPLETED', 'FAILED', 'CANCELLED'];

function isTerminal(workflow?: Workflow): boolean {
  return workflow ? TERMINAL_STATUSES.includes(workflow.status) : false;
}

// ─── useWorkflow ──────────────────────────────────────────────────────────────

export function useWorkflow(workflowId: string | null | undefined) {
  const { data, error, isLoading, mutate } = useSWR<Workflow>(
    workflowId ? `/api/workflows/${workflowId}` : null,
    fetcher,
    {
      refreshInterval: (data) => {
        // Stop polling once terminal
        if (isTerminal(data)) return 0;
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
  if (filters?.pageSize) params.set('pageSize', String(filters.pageSize));

  const qs = params.toString();
  const key = `/api/workflows${qs ? `?${qs}` : ''}`;

  const { data, error, isLoading, mutate } = useSWR<PaginatedResponse<Workflow>>(
    key,
    fetcher,
    {
      refreshInterval: 10_000,
      ...config,
    },
  );

  return {
    workflows: data?.data ?? [],
    total: data?.total ?? 0,
    totalPages: data?.totalPages ?? 0,
    isLoading,
    error,
    refresh: mutate,
  };
}

// ─── useApprovals ─────────────────────────────────────────────────────────────

export function useApprovals(status: 'pending' | 'all' = 'pending') {
  const { data, error, isLoading, mutate } = useSWR<ApprovalRequest[]>(
    `/api/approvals${status !== 'all' ? `?status=${status}` : ''}`,
    fetcher,
    {
      refreshInterval: 5_000, // Poll every 5s for new approvals
      revalidateOnFocus: true,
    },
  );

  return {
    approvals: data ?? [],
    pendingCount: data?.filter(a => a.status === 'PENDING').length ?? 0,
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
