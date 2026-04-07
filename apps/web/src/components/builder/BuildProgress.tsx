'use client';

import React from 'react';
import { CheckCircle, Loader2, XCircle, AlertCircle } from 'lucide-react';

export interface BuildStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  detail?: string;
}

interface BuildProgressProps {
  steps: BuildStep[];
  className?: string;
}

const STATUS_ICONS = {
  pending: <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30" />,
  running: <Loader2 className="h-4 w-4 animate-spin text-primary" />,
  completed: <CheckCircle className="h-4 w-4 text-emerald-500" />,
  failed: <XCircle className="h-4 w-4 text-destructive" />,
  skipped: <AlertCircle className="h-4 w-4 text-muted-foreground" />,
};

export function BuildProgress({ steps, className }: BuildProgressProps) {
  if (steps.length === 0) return null;

  const completedCount = steps.filter(s => s.status === 'completed').length;
  const progress = Math.round((completedCount / steps.length) * 100);

  return (
    <div className={className}>
      {/* Progress bar */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500 rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground font-mono">{progress}%</span>
      </div>

      {/* Steps */}
      <div className="space-y-1.5">
        {steps.map((step, i) => (
          <div key={step.id} className="flex items-start gap-2">
            <div className="mt-0.5 shrink-0">{STATUS_ICONS[step.status]}</div>
            <div className="min-w-0">
              <p className={`text-xs font-medium ${step.status === 'running' ? 'text-primary' : step.status === 'pending' ? 'text-muted-foreground' : ''}`}>
                {step.label}
              </p>
              {step.detail && (
                <p className="text-[10px] text-muted-foreground truncate">{step.detail}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Convert SSE events into BuildStep array for the UI.
 */
export function eventsToBuildSteps(events: Array<{ type: string; [key: string]: unknown }>): BuildStep[] {
  const steps: BuildStep[] = [
    { id: 'architect', label: 'Analyzing requirements', status: 'pending' },
    { id: 'generate', label: 'Generating code', status: 'pending' },
    { id: 'save', label: 'Saving files', status: 'pending' },
    { id: 'install', label: 'Installing dependencies', status: 'pending' },
    { id: 'build', label: 'Building project', status: 'pending' },
    { id: 'preview', label: 'Starting preview', status: 'pending' },
  ];

  for (const event of events) {
    switch (event.type) {
      case 'generation_started':
      case 'architect_started':
        steps[0]!.status = 'running';
        break;
      case 'architect_completed':
        steps[0]!.status = 'completed';
        steps[0]!.detail = `${event.fileCount ?? 0} files planned`;
        steps[1]!.status = 'running';
        break;
      case 'generation_files_started':
        steps[1]!.status = 'running';
        break;
      case 'file_generated':
        steps[1]!.detail = `Batch ${event.batchIndex ?? ''}/${event.totalBatches ?? ''}`;
        break;
      case 'files_saved':
        steps[1]!.status = 'completed';
        steps[1]!.detail = `${event.fileCount ?? 0} files`;
        steps[2]!.status = 'completed';
        break;
      case 'installing_deps':
        steps[3]!.status = 'running';
        break;
      case 'files_synced':
        steps[2]!.status = 'completed';
        steps[3]!.status = 'running';
        break;
      case 'build_started':
      case 'build_attempt':
        steps[3]!.status = 'completed';
        steps[4]!.status = 'running';
        steps[4]!.detail = event.attempt ? `Attempt ${event.attempt}` : undefined;
        break;
      case 'build_success':
        steps[4]!.status = 'completed';
        steps[5]!.status = 'running';
        break;
      case 'build_error':
        steps[4]!.detail = 'Fixing errors...';
        break;
      case 'debug_started':
        steps[4]!.detail = `Debug attempt ${event.attempt ?? ''}`;
        break;
      case 'debug_applied':
        steps[4]!.detail = `Fixed ${(event.fixedFiles as string[])?.length ?? 0} files, rebuilding...`;
        break;
      case 'preview_ready':
        steps[5]!.status = 'completed';
        steps[5]!.detail = 'Live preview available';
        break;
      case 'generation_completed':
        steps[5]!.status = 'completed';
        break;
      case 'generation_failed':
      case 'build_failed':
        for (const step of steps) {
          if (step.status === 'running') step.status = 'failed';
          if (step.status === 'pending') step.status = 'skipped';
        }
        break;
    }
  }

  return steps;
}
