'use client';

import React, { useState } from 'react';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { DndContext, type DragEndEvent, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Zap } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useShellStore } from '@/store/shell-store';
import {
  MODULE_DEFINITIONS,
  CATEGORY_ORDER,
  CATEGORY_META,
  type ModuleCategory,
  type ModuleDefinition,
} from '@/modules/registry';
import { useAuth } from '@/lib/auth';

// ─── Sortable Dock Icon ─────────────────────────────────────────────────────

function DockIcon({ module, isOpen, isActive, isMinimized, onClick }: {
  module: ModuleDefinition;
  isOpen: boolean;
  isActive: boolean;
  isMinimized: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: module.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const Icon = module.icon;

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        'group relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200',
        isActive
          ? 'bg-primary/15 text-primary shadow-sm shadow-primary/20'
          : isOpen
            ? 'bg-muted/60 text-foreground hover:bg-muted'
            : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
        isMinimized && 'opacity-50',
      )}
      title={module.title}
    >
      <Icon className="h-4.5 w-4.5" />

      {/* Active indicator dot */}
      {isOpen && (
        <span
          className={cn(
            'absolute left-0 top-1/2 -translate-y-1/2 -translate-x-0.5 h-1.5 w-1.5 rounded-full transition-all',
            isActive ? 'bg-primary scale-100' : 'bg-muted-foreground/40 scale-75',
          )}
        />
      )}

      {/* Tooltip */}
      <span className="absolute left-full ml-3 hidden group-hover:flex items-center whitespace-nowrap rounded-md bg-popover border border-border px-2.5 py-1 text-xs font-medium shadow-lg z-50">
        {module.title}
      </span>
    </button>
  );
}

// ─── Category Divider ────────────────────────────────────────────────────────

function CategoryDivider({ category }: { category: ModuleCategory }) {
  const meta = CATEGORY_META[category];
  return (
    <div className="flex items-center justify-center py-1.5 px-2">
      <span className={cn('h-1 w-1 rounded-full', meta.dotColor)} />
    </div>
  );
}

// ─── Dock ────────────────────────────────────────────────────────────────────

export function Dock() {
  const { user } = useAuth();
  const openModules = useShellStore(s => s.openModules);
  const activeModuleId = useShellStore(s => s.activeModuleId);
  const minimizedModules = useShellStore(s => s.minimizedModules);
  const openModule = useShellStore(s => s.openModule);
  const restoreModule = useShellStore(s => s.restoreModule);
  const setActiveModule = useShellStore(s => s.setActiveModule);
  const dockOrder = useShellStore(s => s.dockOrder);
  const setDockOrder = useShellStore(s => s.setDockOrder);
  const [contextMenu, setContextMenu] = useState<{ moduleId: string; x: number; y: number } | null>(null);

  // Require 5px drag distance before activating DnD — lets clicks pass through
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Filter modules by user role
  const visibleModules = MODULE_DEFINITIONS.filter(
    m => !m.adminOnly || user?.role === 'TENANT_ADMIN' || user?.role === 'SYSTEM_ADMIN',
  );

  // Sort by dock order if set, otherwise by registry order
  const sortedModules = dockOrder.length > 0
    ? [...visibleModules].sort((a, b) => {
      const ai = dockOrder.indexOf(a.id);
      const bi = dockOrder.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    })
    : visibleModules;

  // Group by category
  const grouped = CATEGORY_ORDER.map(cat => ({
    category: cat,
    modules: sortedModules.filter(m => m.category === cat),
  })).filter(g => g.modules.length > 0);

  const handleClick = (moduleId: string) => {
    if (minimizedModules.has(moduleId)) {
      restoreModule(moduleId);
    } else if (openModules.has(moduleId)) {
      setActiveModule(moduleId);
    } else {
      openModule(moduleId);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const allIds = sortedModules.map(m => m.id);
      const oldIndex = allIds.indexOf(active.id as string);
      const newIndex = allIds.indexOf(over.id as string);
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = [...allIds];
        newOrder.splice(oldIndex, 1);
        newOrder.splice(newIndex, 0, active.id as string);
        setDockOrder(newOrder);
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent, moduleId: string) => {
    e.preventDefault();
    setContextMenu({ moduleId, x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <aside className="flex h-full w-14 flex-col items-center border-r border-border/40 bg-background/80 backdrop-blur-xl py-3 shrink-0">
        {/* Logo */}
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary mb-4 drop-shadow-[0_0_8px_rgba(52,211,153,0.4)]">
          <Zap className="h-4.5 w-4.5 text-primary-foreground" />
        </div>

        {/* Module icons */}
        <nav className="flex-1 flex flex-col items-center gap-0.5 overflow-y-auto w-full px-2 scrollbar-none">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={sortedModules.map(m => m.id)}
              strategy={verticalListSortingStrategy}
            >
              {grouped.map((group, gi) => (
                <React.Fragment key={group.category}>
                  {gi > 0 && <CategoryDivider category={group.category} />}
                  {group.modules.map(module => (
                    <div
                      key={module.id}
                      onContextMenu={(e) => handleContextMenu(e, module.id)}
                    >
                      <DockIcon
                        module={module}
                        isOpen={openModules.has(module.id)}
                        isActive={activeModuleId === module.id}
                        isMinimized={minimizedModules.has(module.id)}
                        onClick={() => handleClick(module.id)}
                      />
                    </div>
                  ))}
                </React.Fragment>
              ))}
            </SortableContext>
          </DndContext>
        </nav>

        {/* Minimized indicator */}
        {minimizedModules.size > 0 && (
          <div className="mt-2 pt-2 border-t border-border/40 flex flex-col items-center gap-1">
            <span className="text-[9px] text-muted-foreground font-medium">
              {minimizedModules.size}
            </span>
          </div>
        )}
      </aside>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-[100]"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="fixed z-[101] w-48 rounded-lg border bg-popover p-1 shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => { openModule(contextMenu.moduleId); setContextMenu(null); }}
              className="w-full text-left px-3 py-1.5 text-xs rounded-md hover:bg-accent transition-colors"
            >
              Open in tile
            </button>
            <button
              onClick={() => {
                const { floatModule } = useShellStore.getState();
                openModule(contextMenu.moduleId);
                floatModule(contextMenu.moduleId);
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 text-xs rounded-md hover:bg-accent transition-colors"
            >
              Open as floating window
            </button>
          </div>
        </>
      )}
    </>
  );
}
