import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversationStore } from '@/store/conversation-store';

const { mockCreateWorkflow, mockConnectSSE, mockSupabaseGetSession } = vi.hoisted(() => ({
  mockCreateWorkflow: vi.fn(),
  mockConnectSSE: vi.fn(),
  mockSupabaseGetSession: vi.fn(),
}));

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: () => false,
}));

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return {
    ...actual,
    workflowApi: {
      ...actual.workflowApi,
      create: mockCreateWorkflow,
    },
  };
});

vi.mock('@/lib/sse-fetch', () => ({
  connectSSE: mockConnectSSE,
}));

vi.mock('@/lib/supabase', () => ({
  createClient: () => ({
    auth: {
      getSession: mockSupabaseGetSession,
    },
  }),
}));

vi.mock('./RolePicker', () => ({
  RolePicker: () => <div data-testid="role-picker" />, 
}));

vi.mock('./EmptyState', () => ({
  EmptyState: ({ onStartChat }: { onStartChat: (prompt: string) => void }) => (
    <button type="button" onClick={() => onStartChat('')} data-testid="empty-state">
      Empty
    </button>
  ),
}));

vi.mock('./ChatInput', () => ({
  ChatInput: ({
    value,
    onChange,
    onSend,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    onSend: () => void;
    disabled?: boolean;
  }) => (
    <div>
      <textarea
        data-testid="chat-input-textarea"
        value={value}
        onChange={(event) => onChange((event.target as HTMLTextAreaElement).value)}
      />
      <button type="button" aria-label="Send message" onClick={onSend} disabled={disabled}>
        Send message
      </button>
    </div>
  ),
}));

vi.mock('./MessageThread', () => ({
  MessageThread: ({ messages }: { messages: Array<{ id: string; content: string }> }) => (
    <div data-testid="message-thread">
      {messages.map((message) => (
        <p key={message.id}>{message.content}</p>
      ))}
    </div>
  ),
}));

vi.mock('@/components/workspace/TaskList', () => ({
  TaskList: () => <div data-testid="task-list" />,
}));

vi.mock('@/components/graph/WorkflowDAG', () => ({
  WorkflowDAG: () => <div data-testid="workflow-dag" />,
}));

import { ChatWorkspace } from './ChatWorkspace';

function resetConversationState() {
  useConversationStore.setState({
    conversations: [],
    activeConversationId: null,
    messages: {},
    activeRoles: ['cto'],
    sidebarCollapsed: false,
    drawerOpen: false,
    _hasHydrated: true,
  });
}

describe('ChatWorkspace follow-up lifecycle contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem('jak-conversations');
    resetConversationState();
    mockSupabaseGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'test-token',
        },
      },
    });
  });

  it('does not emit a fake workflow-started message for followup_executed responses', async () => {
    mockCreateWorkflow.mockResolvedValue({
      kind: 'followup_executed',
      workflowId: 'wf_followup_123',
      description: 'Continuing the workflow...',
      command: { kind: 'continue' },
    });

    render(<ChatWorkspace />);

    fireEvent.change(screen.getByTestId('chat-input-textarea'), {
      target: { value: 'continue' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(mockCreateWorkflow).toHaveBeenCalledTimes(1);
    });

    expect(mockConnectSSE).not.toHaveBeenCalled();

    await waitFor(() => {
      const thread = screen.getByTestId('message-thread');
      expect(thread.textContent ?? '').toContain('Continuing the workflow...');
      expect(thread.textContent ?? '').toContain('/swarm?workflowId=wf_followup_123');
    });

    expect(screen.queryByText(/Workflow started — processing your request/i)).toBeNull();
  });

  it('shows a clean start error when the create response has no workflow id', async () => {
    mockCreateWorkflow.mockResolvedValue({
      kind: 'workflow_created',
    });

    render(<ChatWorkspace />);

    fireEvent.change(screen.getByTestId('chat-input-textarea'), {
      target: { value: 'review this website' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(mockCreateWorkflow).toHaveBeenCalledTimes(1);
    });

    expect(mockConnectSSE).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(
        screen.getByText(/Failed to start workflow: Workflow API did not return a valid workflow ID\./i),
      ).toBeInTheDocument();
    });
  });
});
