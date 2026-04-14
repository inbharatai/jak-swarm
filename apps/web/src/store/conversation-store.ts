'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RoleId } from '@/lib/role-config';

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
      activeRoles: ['cto'],
      sidebarCollapsed: false,
      drawerOpen: false,

      // Actions
      createConversation: (roles) => {
        const id = generateId();
        const selectedRoles = roles ?? get().activeRoles;
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
          set({ activeConversationId: id, activeRoles: conv.roles });
        }
      },

      setActiveRoles: (roles) => {
        set({ activeRoles: roles });
        const activeId = get().activeConversationId;
        if (activeId) {
          set((state) => ({
            conversations: state.conversations.map((c) =>
              c.id === activeId ? { ...c, roles } : c,
            ),
          }));
        }
      },

      toggleRole: (role) => {
        const current = get().activeRoles;
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
      partialize: (state) => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
        messages: state.messages,
        activeRoles: state.activeRoles,
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
