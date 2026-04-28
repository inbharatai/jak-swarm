'use client';

import React from 'react';
import { TopBar } from './TopBar';
import { ChatSidebar } from './ChatSidebar';
import { CommandPalette } from './CommandPalette';

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <ChatSidebar />
        {/* Bug fix: main was `overflow-hidden` which clipped every non-chat
            page (Analytics, Files, Settings, Knowledge, etc.) at the
            viewport edge — charts and lists below the fold were invisible
            and unscrollable. Chat doesn't regress because it has its own
            `overflow-hidden` + internal MessageThread scroll container. */}
        <main className="flex flex-1 flex-col overflow-y-auto">
          {children}
        </main>
      </div>
      {/* Cmd+K palette — mounted once, listens globally. Replaces deep
          sidebar navigation for the 17 dashboard routes. */}
      <CommandPalette />
    </div>
  );
}
