'use client';

import useSWR from 'swr';
import { apiFetch } from '@/lib/api-client';

const TERMINAL_STATUSES = ['READY', 'DEPLOYED', 'FAILED', 'DRAFT'];

export interface ProjectFile {
  id: string;
  projectId: string;
  path: string;
  content: string;
  language: string | null;
  size: number;
  hash: string | null;
  isDeleted: boolean;
}

export interface ProjectVersion {
  id: string;
  projectId: string;
  version: number;
  description: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ProjectConversation {
  id: string;
  projectId: string;
  role: string;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface Project {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  description: string | null;
  framework: string;
  status: string;
  sandboxId: string | null;
  previewUrl: string | null;
  deploymentUrl: string | null;
  githubRepo: string | null;
  currentVersion: number;
  totalCostUsd: number;
  createdAt: string;
  updatedAt: string;
  files?: ProjectFile[];
  versions?: ProjectVersion[];
  conversations?: ProjectConversation[];
}

export function useProject(projectId: string | undefined) {
  const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: Project }>(
    projectId ? `/projects/${projectId}` : null,
    (url: string) => apiFetch<{ success: boolean; data: Project }>(url),
    {
      refreshInterval: (data) => {
        const status = data?.data?.status;
        if (status && TERMINAL_STATUSES.includes(status)) return 0;
        return 2000; // Poll every 2s while generating/building
      },
    },
  );

  return {
    project: data?.data,
    isLoading,
    error,
    refresh: mutate,
    isGenerating: data?.data?.status === 'GENERATING' || data?.data?.status === 'BUILDING',
  };
}

export function useProjects(options?: { status?: string; page?: number }) {
  const params = new URLSearchParams();
  if (options?.status) params.set('status', options.status);
  if (options?.page) params.set('page', String(options.page));

  const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: { projects: Project[]; total: number; totalPages: number } }>(
    `/projects?${params.toString()}`,
    (url: string) => apiFetch<{ success: boolean; data: { projects: Project[]; total: number; totalPages: number } }>(url),
  );

  return {
    projects: data?.data?.projects ?? [],
    total: data?.data?.total ?? 0,
    totalPages: data?.data?.totalPages ?? 0,
    isLoading,
    error,
    refresh: mutate,
  };
}
