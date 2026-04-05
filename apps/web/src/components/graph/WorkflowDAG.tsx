'use client';

import React, { useMemo, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { AgentNode } from './AgentNode';
import { OrchestratorNode } from './OrchestratorNode';
import { ApprovalNode } from './ApprovalNode';
import { buildGraphLayout } from './graph-layout';
import { cn } from '@/lib/cn';
import type { WorkflowPlan } from '@/types';

const nodeTypes = {
  agent: AgentNode,
  orchestrator: OrchestratorNode,
  approval: ApprovalNode,
} as const;

interface WorkflowDAGProps {
  plan?: WorkflowPlan;
  workflowStatus?: string;
  className?: string;
  onNodeClick?: (stepId: string) => void;
}

export function WorkflowDAG({ plan, workflowStatus, className, onNodeClick }: WorkflowDAGProps) {
  const { computedNodes, computedEdges } = useMemo(() => {
    if (!plan?.steps || plan.steps.length === 0) {
      return { computedNodes: [], computedEdges: [] };
    }

    const result = buildGraphLayout(plan.steps);

    // Derive orchestrator statuses from workflow progress
    const hasStarted = plan.steps.some(s => s.status !== 'PENDING');
    const allComplete = plan.steps.every(
      s => s.status === 'COMPLETED' || s.status === 'SKIPPED',
    );

    const updatedNodes = result.nodes.map(n => {
      if (n.id === 'commander' || n.id === 'planner' || n.id === 'router') {
        return {
          ...n,
          data: { ...n.data, status: hasStarted ? 'COMPLETED' : 'IN_PROGRESS' },
        };
      }
      if (n.id === 'verifier') {
        const verifierStatus = allComplete
          ? 'COMPLETED'
          : workflowStatus === 'VERIFYING'
            ? 'IN_PROGRESS'
            : 'PENDING';
        return { ...n, data: { ...n.data, status: verifierStatus } };
      }
      return n;
    });

    return { computedNodes: updatedNodes, computedEdges: result.edges };
  }, [plan, workflowStatus]);

  const [nodes, setNodes, onNodesChange] = useNodesState(computedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(computedEdges);

  // Keep nodes/edges in sync when plan updates via SSE
  useEffect(() => {
    if (computedNodes.length > 0) {
      setNodes(computedNodes);
      setEdges(computedEdges);
    }
  }, [computedNodes, computedEdges, setNodes, setEdges]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const orchIds = new Set(['commander', 'planner', 'router', 'verifier']);
      if (onNodeClick && !orchIds.has(node.id)) {
        onNodeClick(node.id);
      }
    },
    [onNodeClick],
  );

  if (!plan?.steps || plan.steps.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-center text-sm text-muted-foreground py-12',
          className,
        )}
      >
        Submit a task to see the execution graph
      </div>
    );
  }

  return (
    <div className={cn('w-full h-[500px] rounded-lg border bg-background', className)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { strokeWidth: 1.5, stroke: '#94a3b8' },
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={0.5} color="#e2e8f0" />
        <Controls showInteractive={false} className="!bg-background !border !shadow-sm" />
        <MiniMap
          nodeStrokeWidth={3}
          className="!bg-muted/50 !border"
          maskColor="rgba(0,0,0,0.05)"
        />
      </ReactFlow>
    </div>
  );
}
