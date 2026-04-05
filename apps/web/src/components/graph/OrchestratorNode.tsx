'use client';

import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AGENT_COLORS, DEFAULT_COLOR, ROLE_EMOJIS, STATUS_COLORS } from './graph-theme';
import { cn } from '@/lib/cn';
import type { TaskStatus } from '@/types';

interface OrchestratorNodeData extends Record<string, unknown> {
  label: string;
  role: string;
  status: string;
}

function OrchestratorNodeComponent({ data }: NodeProps & { data: OrchestratorNodeData }) {
  const colors = AGENT_COLORS[data.role as string] ?? DEFAULT_COLOR;
  const emoji = ROLE_EMOJIS[data.role as string] ?? '⚡';
  const statusColor = STATUS_COLORS[data.status as TaskStatus] ?? 'text-muted-foreground';
  const isRunning = data.status === 'IN_PROGRESS';

  return (
    <div
      className={cn(
        'rounded-xl border-2 px-4 py-2 shadow-md transition-all min-w-[180px] text-center bg-background',
        colors.bg,
        colors.border,
        isRunning && 'ring-2 ring-blue-400 ring-offset-1 animate-pulse',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-400 !w-2 !h-2" />

      <div className="flex items-center justify-center gap-2">
        <span className="leading-none">{emoji}</span>
        <span className={cn('text-xs font-bold uppercase tracking-wider', colors.text)}>
          {data.label as string}
        </span>
      </div>
      <p className={cn('text-[10px] mt-0.5', statusColor)}>
        {(data.status as string)?.replace(/_/g, ' ')}
      </p>

      <Handle type="source" position={Position.Bottom} className="!bg-slate-400 !w-2 !h-2" />
    </div>
  );
}

export const OrchestratorNode = memo(OrchestratorNodeComponent);
