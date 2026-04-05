'use client';

import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AGENT_COLORS, DEFAULT_COLOR, ROLE_EMOJIS, STATUS_COLORS } from './graph-theme';
import { cn } from '@/lib/cn';
import type { TaskStatus } from '@/types';

interface AgentNodeData extends Record<string, unknown> {
  label: string;
  role: string;
  status: string;
  toolCalls?: number;
  duration?: number;
  description?: string;
}

function AgentNodeComponent({ data }: NodeProps & { data: AgentNodeData }) {
  const colors = AGENT_COLORS[data.role as string] ?? DEFAULT_COLOR;
  const emoji = ROLE_EMOJIS[data.role as string] ?? '🤖';
  const statusColor = STATUS_COLORS[data.status as TaskStatus] ?? 'text-muted-foreground';
  const isRunning = data.status === 'IN_PROGRESS';
  const isFailed = data.status === 'FAILED';
  const roleName = ((data.role as string) ?? '').replace('WORKER_', '').replace(/_/g, ' ');

  return (
    <div
      className={cn(
        'rounded-lg border-2 px-3 py-2.5 shadow-sm transition-all min-w-[200px] bg-background',
        colors.bg,
        colors.border,
        isRunning && 'ring-2 ring-blue-400 ring-offset-1 animate-pulse',
        isFailed && 'ring-2 ring-red-400 ring-offset-1',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-400 !w-2 !h-2" />

      <div className="flex items-center gap-2 mb-1">
        <span className="text-base leading-none">{emoji}</span>
        <span className={cn('text-[10px] font-bold uppercase tracking-wide', colors.text)}>
          {roleName}
        </span>
      </div>

      <p className="text-[11px] text-foreground font-medium truncate mb-1.5">
        {data.label as string}
      </p>

      <div className="flex items-center justify-between text-[10px]">
        <span className={cn('font-medium', statusColor)}>
          {isRunning && <span className="inline-block animate-spin mr-0.5">&#8635;</span>}
          {(data.status as string)?.replace(/_/g, ' ')}
        </span>
        <div className="flex items-center gap-2 text-muted-foreground">
          {data.toolCalls != null && (data.toolCalls as number) > 0 && (
            <span>&#128295; {data.toolCalls as number}</span>
          )}
          {data.duration != null && (
            <span>{((data.duration as number) / 1000).toFixed(1)}s</span>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-slate-400 !w-2 !h-2" />
    </div>
  );
}

export const AgentNode = memo(AgentNodeComponent);
