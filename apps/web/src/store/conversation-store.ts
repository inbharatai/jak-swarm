'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ROLE_IDS, type RoleId } from '@/lib/role-config';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  /** Which agent role authored this (null for user messages) */
  agentRole: RoleId | null;
  content: string;
  createdAt: number;
  /** Execution metadata, lazy-loaded */
  executionTrace?: {
    workflowId?: string;
    steps?: { name: string; status: string; duration?: number }[];
  };
}

export interface Conversation {
  id: string;
  title: string;
  /** Roles active for this conversation */
  roles: RoleId[];
  createdAt: number;
  updatedAt: number;
  /** Optional project grouping */
  projectId?: string;
}

export interface ConversationState {
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Record<string, Message[]>;
  /** Currently selected roles for the next message */
  activeRoles: RoleId[];
  /** Sidebar collapsed state */
  sidebarCollapsed: boolean;
  /** Detail drawer open state */
  drawerOpen: boolean;
}

export interface ConversationActions {
  createConversation: (roles?: RoleId[]) => string;
  deleteConversation: (id: string) => void;
  switchConversation: (id: string) => void;
  setActiveRoles: (roles: RoleId[]) => void;
  toggleRole: (role: RoleId) => void;
  addMessage: (conversationId: string, message: Omit<Message, 'id' | 'conversationId' | 'createdAt'>) => void;
  updateConversationTitle: (id: string, title: string) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setDrawerOpen: (open: boolean) => void;
}

type PersistedConversationState = Pick<
  ConversationState,
  'conversations' | 'activeConversationId' | 'messages' | 'activeRoles'
>;

const DEFAULT_ACTIVE_ROLES: RoleId[] = ['cto'];

function isRoleId(value: unknown): value is RoleId {
  return typeof value === 'string' && ROLE_IDS.includes(value as RoleId);
}

function normalizeRoles(value: unknown): RoleId[] {
  const roles = Array.isArray(value)
    ? value.filter(isRoleId)
    : isRoleId(value)
      ? [value]
      : [];

  return roles.length > 0 ? Array.from(new Set(roles)) : DEFAULT_ACTIVE_ROLES;
}

function normalizeConversations(value: unknown): Conversation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const record = entry as Record<string, unknown>;
    if (typeof record.id !== 'string' || record.id.length === 0) {
      return [];
    }

    const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();
    const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : createdAt;

    return [{
      id: record.id,
      title: typeof record.title === 'string' && record.title.trim().length > 0
        ? record.title
        : 'New conversation',
      roles: normalizeRoles(record.roles),
      createdAt,
      updatedAt,
      projectId: typeof record.projectId === 'string' ? record.projectId : undefined,
    }];
  });
}

function normalizeMessages(value: unknown): Record<string, Message[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, Message[]> = {};

  for (const [conversationId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(entry)) {
      continue;
    }

    normalized[conversationId] = entry.flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return [];
      }

      const record = item as Record<string, unknown>;
      if (typeof record.content !== 'string' || (record.role !== 'user' && record.role !== 'assistant')) {
        return [];
      }

      const executionTrace =
        record.executionTrace && typeof record.executionTrace === 'object'
          ? (() => {
              const trace = record.executionTrace as Record<string, unknown>;
              const steps = Array.isArray(trace.steps)
                ? trace.steps.flatMap((step) => {
                    if (!step || typeof step !== 'object') {
                      return [];
                    }
                    const stepRecord = step as Record<string, unknown>;
                    if (typeof stepRecord.name !== 'string' || typeof stepRecord.status !== 'string') {
                      return [];
                    }
                    return [{
                      name: stepRecord.name,
                      status: stepRecord.status,
                      duration: typeof stepRecord.duration === 'number' ? stepRecord.duration : undefined,
                    }];
                  })
                : undefined;

              return {
                workflowId: typeof trace.workflowId === 'string' ? trace.workflowId : undefined,
                steps,
              };
            })()
          : undefined;

      return [{
        id: typeof record.id === 'string' ? record.id : generateId(),
        conversationId,
        role: record.role,
        agentRole: isRoleId(record.agentRole) ? record.agentRole : null,
        content: record.content,
        createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
        executionTrace,
      }];
    });
  }

  return normalized;
}

function sanitizeConversationState(value: unknown): PersistedConversationState {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const conversations = normalizeConversations(record.conversations);
  const messages = normalizeMessages(record.messages);
  const activeConversationId =
    typeof record.activeConversationId === 'string' && conversations.some((conv) => conv.id === record.activeConversationId)
      ? record.activeConversationId
      : conversations[0]?.id ?? null;

  return {
    conversations,
    activeConversationId,
    messages,
    activeRoles: normalizeRoles(record.activeRoles),
  };
}

// ─── Store ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useConversationStore = create<ConversationState & ConversationActions>()(
  persist(
    (set, get) => ({
      // State
      conversations: [],
      activeConversationId: null,
      messages: {},
      activeRoles: DEFAULT_ACTIVE_ROLES,
      sidebarCollapsed: false,
      drawerOpen: false,

      // Actions
      createConversation: (roles) => {
        const id = generateId();
        const selectedRoles = normalizeRoles(roles ?? get().activeRoles);
        const conversation: Conversation = {
          id,
          title: 'New conversation',
          roles: selectedRoles,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((state) => ({
          conversations: [conversation, ...state.conversations],
          activeConversationId: id,
          messages: { ...state.messages, [id]: [] },
          activeRoles: selectedRoles,
        }));
        return id;
      },

      deleteConversation: (id) => {
        set((state) => {
          const { [id]: _, ...rest } = state.messages;
          const remaining = state.conversations.filter((c) => c.id !== id);
          return {
            conversations: remaining,
            messages: rest,
            activeConversationId:
              state.activeConversationId === id
                ? remaining[0]?.id ?? null
                : state.activeConversationId,
          };
        });
      },

      switchConversation: (id) => {
        const conv = get().conversations.find((c) => c.id === id);
        if (conv) {
          set({ activeConversationId: id, activeRoles: normalizeRoles(conv.roles) });
        }
      },

      setActiveRoles: (roles) => {
        const normalizedRoles = normalizeRoles(roles);
        set({ activeRoles: normalizedRoles });
        const activeId = get().activeConversationId;
        if (activeId) {
          set((state) => ({
            conversations: state.conversations.map((c) =>
              c.id === activeId ? { ...c, roles: normalizedRoles } : c,
            ),
          }));
        }
      },

      toggleRole: (role) => {
        const current = normalizeRoles(get().activeRoles);
        const next = current.includes(role)
          ? current.filter((r) => r !== role)
          : [...current, role];
        // Must have at least one role
        if (next.length > 0) {
          get().setActiveRoles(next);
        }
      },

      addMessage: (conversationId, message) => {
        const newMsg: Message = {
          ...message,
          id: generateId(),
          conversationId,
          createdAt: Date.now(),
        };
        set((state) => {
          const existing = state.messages[conversationId] ?? [];
          // Auto-title from first user message
          const isFirst = existing.length === 0 && message.role === 'user';
          return {
            messages: {
              ...state.messages,
              [conversationId]: [...existing, newMsg],
            },
            conversations: state.conversations.map((c) =>
              c.id === conversationId
                ? {
                    ...c,
                    updatedAt: Date.now(),
                    ...(isFirst && { title: message.content.slice(0, 60) }),
                  }
                : c,
            ),
          };
        });
      },

      updateConversationTitle: (id, title) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === id ? { ...c, title } : c,
          ),
        }));
      },

      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setDrawerOpen: (open) => set({ drawerOpen: open }),
    }),
    {
      name: 'jak-conversations',
      version: 1,
      migrate: (persistedState) => sanitizeConversationState(persistedState),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...sanitizeConversationState(persistedState),
      }),
      partialize: (state) => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
        messages: state.messages,
        activeRoles: normalizeRoles(state.activeRoles),
      }),
    },
  ),
);

// ─── Selectors ───────────────────────────────────────────────────────────────
// Use single selectors to avoid re-renders from multiple subscriptions deriving
// the same value.

const EMPTY_MESSAGES: Message[] = [];

export function useActiveConversation() {
  return useConversationStore((s) =>
    s.activeConversationId
      ? s.conversations.find((c) => c.id === s.activeConversationId) ?? null
      : null,
  );
}

export function useActiveMessages() {
  return useConversationStore((s) =>
    s.activeConversationId ? s.messages[s.activeConversationId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES,
  );
}
