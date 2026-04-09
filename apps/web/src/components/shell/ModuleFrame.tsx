'use client';

import React, { Component, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { Minimize2, Maximize2, ExternalLink, X, RotateCcw, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { getModule, type ModuleDefinition } from '@/modules/registry';
import { useShellStore } from '@/store/shell-store';
import { Spinner } from '@/components/ui/spinner';

// ─── Error Boundary ──────────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  moduleId: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ModuleErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[Module ${this.props.moduleId}] Crash:`, error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <p className="text-sm font-medium">Module crashed</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
          </div>
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Reload module
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Loading fallback ────────────────────────────────────────────────────────

function ModuleLoadingFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex flex-col items-center gap-3">
        <Spinner size="default" />
        <p className="text-xs text-muted-foreground">Loading module…</p>
      </div>
    </div>
  );
}

// ─── Module Frame ────────────────────────────────────────────────────────────

interface ModuleFrameProps {
  moduleId: string;
  showTitleBar?: boolean;
  className?: string;
}

export function ModuleFrame({ moduleId, showTitleBar = true, className }: ModuleFrameProps) {
  const moduleDef = getModule(moduleId);
  const activeModuleId = useShellStore(s => s.activeModuleId);
  const closeModule = useShellStore(s => s.closeModule);
  const minimizeModule = useShellStore(s => s.minimizeModule);
  const maximizeModule = useShellStore(s => s.maximizeModule);
  const floatModule = useShellStore(s => s.floatModule);
  const setActiveModule = useShellStore(s => s.setActiveModule);
  const floatingWindows = useShellStore(s => s.floatingWindows);

  if (!moduleDef) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Unknown module: {moduleId}
      </div>
    );
  }

  const isActive = activeModuleId === moduleId;
  const isFloating = floatingWindows.has(moduleId);
  const Icon = moduleDef.icon;
  const ModuleComponent = moduleDef.component;

  return (
    <div
      className={cn(
        'flex flex-col h-full bg-background rounded-lg overflow-hidden',
        isActive ? 'ring-1 ring-primary/30' : 'ring-1 ring-border/30',
        className,
      )}
      onClick={() => setActiveModule(moduleId)}
    >
      {/* Title bar */}
      {showTitleBar && (
        <div
          className={cn(
            'module-title-bar flex items-center gap-2 px-3 py-1.5 border-b border-border/40 select-none shrink-0',
            isActive
              ? 'bg-primary/5'
              : 'bg-muted/30',
          )}
        >
          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium truncate flex-1">{moduleDef.title}</span>

          <div className="flex items-center gap-0.5">
            <button
              onClick={(e) => { e.stopPropagation(); minimizeModule(moduleId); }}
              className="p-1 rounded hover:bg-accent transition-colors"
              title="Minimize"
            >
              <Minimize2 className="h-3 w-3 text-muted-foreground" />
            </button>
            {!isFloating ? (
              <button
                onClick={(e) => { e.stopPropagation(); floatModule(moduleId); }}
                className="p-1 rounded hover:bg-accent transition-colors"
                title="Float window"
              >
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
              </button>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); maximizeModule(moduleId); }}
                className="p-1 rounded hover:bg-accent transition-colors"
                title="Maximize"
              >
                <Maximize2 className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); closeModule(moduleId); }}
              className="p-1 rounded hover:bg-destructive/20 transition-colors"
              title="Close"
            >
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          </div>
        </div>
      )}

      {/* Module content */}
      <div className="flex-1 overflow-auto min-h-0">
        <ModuleErrorBoundary moduleId={moduleId}>
          <Suspense fallback={<ModuleLoadingFallback />}>
            <ModuleComponent moduleId={moduleId} isActive={isActive} />
          </Suspense>
        </ModuleErrorBoundary>
      </div>
    </div>
  );
}
