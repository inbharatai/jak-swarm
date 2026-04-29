'use client';

import React from 'react';
import { ROLE_LIST, RECOMMENDED_COMBOS, getRoleColor, type RoleId } from '@/lib/role-config';
import { useConversationStore } from '@/store/conversation-store';
import { cn } from '@/lib/cn';

interface EmptyStateProps {
  onStartChat: (prompt: string) => void;
}

export function EmptyState({ onStartChat }: EmptyStateProps) {
  const setActiveRoles = useConversationStore((s) => s.setActiveRoles);
  const activeRoles = useConversationStore((s) => s.activeRoles);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="mx-auto max-w-2xl text-center">
        {/* Hero — primary command framing.
            QA H1 fix: copy now points the user at the chat input below
            (which is always visible) rather than the function tiles
            (which used to gate the input). */}
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          What do you want JAK to do?
        </h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
          Describe a task in plain English. JAK plans the steps, runs the right specialists,
          and asks your approval before anything risky leaves the cockpit.
        </p>
        <p className="mt-3 text-xs text-muted-foreground/70 max-w-md mx-auto">
          Tip: pick one of the starter tasks below to see the full loop in under a minute.
        </p>

        {/* Quick Combos */}
        <div className="mt-8">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-3">
            Quick start
          </h3>
          <div className="flex flex-wrap justify-center gap-2">
            {RECOMMENDED_COMBOS.slice(0, 4).map((combo) => (
              <button
                key={combo.label}
                onClick={() => setActiveRoles(combo.roles)}
                className={cn(
                  'group flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-all',
                  'hover:border-primary/30 hover:bg-muted/50',
                  activeRoles.length === combo.roles.length && combo.roles.every((r) => activeRoles.includes(r)) && 'border-primary/40 bg-primary/5',
                )}
              >
                <div className="flex -space-x-0.5">
                  {combo.roles.map((r) => (
                    <span
                      key={r}
                      className="h-2 w-2 rounded-full ring-1 ring-background"
                      style={{ backgroundColor: getRoleColor(r).base }}
                    />
                  ))}
                </div>
                <span className="font-medium text-foreground">{combo.label}</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  — {combo.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Starter Prompts — clicking one drops the example text into the
            (always-visible) chat input below. */}
        <div className="mt-10 grid gap-2 sm:grid-cols-2" data-testid="starter-prompts">
          {getStarterPrompts(activeRoles).map((prompt) => (
            <button
              key={prompt}
              onClick={() => onStartChat(prompt)}
              className={cn(
                'rounded-xl border border-border bg-card px-4 py-3 text-left text-sm transition-all',
                'hover:border-primary/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground',
              )}
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getStarterPrompts(roles: RoleId[]): string[] {
  const pool: string[] = [];
  for (const roleId of roles) {
    const role = ROLE_LIST.find((r) => r.id === roleId);
    if (role) pool.push(...role.examplePrompts);
  }
  // YC-wedge starter prompts (2026-04-29). Each prompt maps to a real
  // system template seeded by `WorkflowTemplateService.seedSystemTemplates`,
  // so clicking one immediately exercises the full plan → execute → approve
  // loop without a cold start. Order is "fastest-to-wow first".
  if (pool.length === 0) {
    return [
      'Research my top 3 competitors and draft a LinkedIn post about how we are different.',
      'Review my website (replace with your URL) and propose 5 specific fixes with file pointers.',
      'Draft a cold-email sequence (initial + 3 follow-ups) for early-stage SaaS founders.',
      'Multi-channel marketing campaign: audience, channel mix, and content drafts for our next launch.',
    ];
  }
  // Return up to 4 unique prompts
  return pool.slice(0, 4);
}
