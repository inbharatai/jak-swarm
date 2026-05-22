import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockUseAuth,
  mockToastSuccess,
  mockToastError,
  mockCompanyBrainApi,
} = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockCompanyBrainApi: {
    getProfile: vi.fn(),
    listArtifacts: vi.fn(),
    listEntities: vi.fn(),
    listDriftFindings: vi.fn(),
    listSpecs: vi.fn(),
    listConnectorSyncStatuses: vi.fn(),
    enableConnectorSync: vi.fn(),
    disableConnectorSync: vi.fn(),
    triggerConnectorSync: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
    success: mockToastSuccess,
    error: mockToastError,
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/lib/api-client', () => ({
  companyBrainApi: mockCompanyBrainApi,
}));

import CompanyBrainPage from './page';

const STATUS_FIXTURES = [
  {
    provider: 'GITHUB',
    integrationProvider: 'GITHUB',
    connected: true,
    enabled: false,
    status: 'idle',
    lastSyncedAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
    cursor: null,
    latestRun: null,
  },
  {
    provider: 'GMAIL',
    integrationProvider: 'GMAIL',
    connected: true,
    enabled: true,
    status: 'idle',
    lastSyncedAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastErrorAt: null,
    consecutiveFailures: 1,
    cursor: null,
    latestRun: {
      id: 'run-1',
      trigger: 'manual',
      status: 'success',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:01:00.000Z',
      fetchedCount: 10,
      ingestedCount: 8,
      skippedCount: 2,
      errorMessage: null,
    },
  },
  {
    provider: 'GOOGLE_DRIVE',
    integrationProvider: null,
    connected: false,
    enabled: false,
    status: 'not_connected',
    lastSyncedAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
    cursor: null,
    latestRun: null,
  },
];

function renderPage(): void {
  render(
    <SWRConfig
      value={{
        provider: () => new Map(),
        dedupingInterval: 0,
        revalidateOnFocus: false,
      }}
    >
      <CompanyBrainPage />
    </SWRConfig>,
  );
}

function getAutosyncCardQueries() {
  const cardTitle = screen.getByText('Connector autosync');
  const card = cardTitle.closest('div.rounded-xl');
  if (!(card instanceof HTMLElement)) {
    throw new Error('Could not find connector autosync card container');
  }
  return within(card);
}

function getConnectorRowQueries(providerLabel: 'GitHub' | 'Gmail' | 'Google Drive') {
  const autosync = getAutosyncCardQueries();
  const providerNode = autosync.getByText(new RegExp(`^${providerLabel}$`), { selector: 'p' });
  const row = providerNode.closest('div.rounded-md');
  if (!(row instanceof HTMLElement)) {
    throw new Error(`Could not find row container for ${providerLabel}`);
  }
  return within(row);
}

beforeEach(() => {
  vi.clearAllMocks();

  mockUseAuth.mockReturnValue({
    user: { role: 'TENANT_ADMIN' },
    isLoading: false,
  });

  mockCompanyBrainApi.getProfile.mockResolvedValue({ profile: null });
  mockCompanyBrainApi.listArtifacts.mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 });
  mockCompanyBrainApi.listEntities.mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 });
  mockCompanyBrainApi.listDriftFindings.mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 });
  mockCompanyBrainApi.listSpecs.mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 });
  mockCompanyBrainApi.listConnectorSyncStatuses.mockResolvedValue({ items: STATUS_FIXTURES });
  mockCompanyBrainApi.enableConnectorSync.mockResolvedValue({ status: STATUS_FIXTURES[0] });
  mockCompanyBrainApi.disableConnectorSync.mockResolvedValue({ status: STATUS_FIXTURES[1] });
  mockCompanyBrainApi.triggerConnectorSync.mockResolvedValue({
    run: {
      runId: 'run-2',
      status: 'success',
      fetchedCount: 5,
      ingestedCount: 4,
      skippedCount: 1,
    },
    status: STATUS_FIXTURES[1],
  });
});

describe('Company connector autosync smoke', () => {
  it('renders the autosync panel with wave-1 providers', async () => {
    renderPage();

    await waitFor(() => {
      expect(mockCompanyBrainApi.listConnectorSyncStatuses).toHaveBeenCalled();
    });

    const autosync = getAutosyncCardQueries();
    expect(autosync.getByText(/^GitHub$/, { selector: 'p' })).toBeInTheDocument();
    expect(autosync.getByText(/^Gmail$/, { selector: 'p' })).toBeInTheDocument();
    expect(autosync.getByText(/^Google Drive$/, { selector: 'p' })).toBeInTheDocument();
    expect(autosync.getByRole('link', { name: 'Connect in Integrations' })).toHaveAttribute('href', '/integrations');
  }, 15_000);

  it('dispatches enable/disable and manual sync actions', async () => {
    renderPage();

    await waitFor(() => {
      expect(mockCompanyBrainApi.listConnectorSyncStatuses).toHaveBeenCalled();
    });

    const githubRow = getConnectorRowQueries('GitHub');
    const gmailRow = getConnectorRowQueries('Gmail');

    fireEvent.click(githubRow.getByRole('button', { name: 'Enable auto-sync' }));
    await waitFor(() => {
      expect(mockCompanyBrainApi.enableConnectorSync).toHaveBeenCalledWith('GITHUB');
    });

    fireEvent.click(gmailRow.getByRole('button', { name: 'Disable auto-sync' }));
    await waitFor(() => {
      expect(mockCompanyBrainApi.disableConnectorSync).toHaveBeenCalledWith('GMAIL');
    });

    fireEvent.click(gmailRow.getByRole('button', { name: 'Run now' }));
    await waitFor(() => {
      expect(mockCompanyBrainApi.triggerConnectorSync).toHaveBeenCalledWith('GMAIL', { mode: 'incremental' });
    });

    fireEvent.click(gmailRow.getByRole('button', { name: 'Full sync' }));
    await waitFor(() => {
      expect(mockCompanyBrainApi.triggerConnectorSync).toHaveBeenCalledWith('GMAIL', { mode: 'full' });
    });
  }, 20_000);
});