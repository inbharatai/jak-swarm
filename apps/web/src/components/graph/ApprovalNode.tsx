'use client';

import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/cn';

interface ApprovalNodeData extends Record<string, unknown> {
  label: string;
  role: string;
  status: string;
}

function ApprovalNodeComponent({ data }: NodeProps & { data: ApprovalNodeData }) {
  const isWaiting = data.status === 'AWAITING_APPROVAL';

  return (
    <div
      className={cn(
        'rounded-lg border-2 px-3 py-2.5 shadow-sm min-w-[200px] bg-background',
        'bg-amber-50 dark:bg-amber-950/40 border-amber-400',
        isWaiting && 'ring-2 ring-amber-400 ring-offset-1 animate-pulse',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-amber-400 !w-2 !h-2" />

      <div className="flex items-center gap-2 mb-1">
        <span className="text-base leading-none">&#9888;&#65039;</span>
        <span className="text-xs font-bold text-amber-700 dark:text-amber-300 uppercase">
          Approval Required
        </span>
      </div>
      <p className="text-[11px] text-foreground font-medium truncate">
        {data.label as string}
      </p>
      <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
        {(data.status as string)?.replace(/_/g, ' ')}
      </p>

      <Handle type="source" position={Position.Bottom} className="!bg-amber-400 !w-2 !h-2" />
    </div>
  );
}

export const ApprovalNode = memo(ApprovalNodeComponent);
