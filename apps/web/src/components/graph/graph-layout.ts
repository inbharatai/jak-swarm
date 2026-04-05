import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';
import type { WorkflowPlanStep } from '@/types';

const NODE_WIDTH = 240;
const NODE_HEIGHT = 100;
const ORCH_HEIGHT = 70;

export function buildGraphLayout(steps: WorkflowPlanStep[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', ranksep: 80, nodesep: 50, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  // Add orchestrator nodes at the top of the graph
  const orchIds = ['commander', 'planner', 'router'] as const;
  for (const id of orchIds) {
    g.setNode(id, { width: NODE_WIDTH, height: ORCH_HEIGHT });
  }
  g.setEdge('commander', 'planner');
  g.setEdge('planner', 'router');

  // Build a set of all step IDs for fast lookup
  const stepIds = new Set(steps.map(s => s.id));

  // Add task nodes from the plan
  for (const step of steps) {
    g.setNode(step.id, { width: NODE_WIDTH, height: NODE_HEIGHT });

    // Filter dependsOn to only include IDs that exist in the plan
    const validDeps = (step.dependsOn ?? []).filter(dep => stepIds.has(dep));

    if (validDeps.length === 0) {
      // Root tasks connect from the router
      g.setEdge('router', step.id);
    } else {
      for (const dep of validDeps) {
        g.setEdge(dep, step.id);
      }
    }
  }

  // Add verifier node at the bottom
  g.setNode('verifier', { width: NODE_WIDTH, height: ORCH_HEIGHT });

  // Leaf steps (not depended on by any other step) connect to verifier
  const leafSteps = steps.filter(
    s => !steps.some(other => (other.dependsOn ?? []).includes(s.id)),
  );
  for (const leaf of leafSteps) {
    g.setEdge(leaf.id, 'verifier');
  }

  dagre.layout(g);

  // Convert dagre output to React Flow nodes and edges
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Orchestrator nodes
  for (const id of orchIds) {
    const pos = g.node(id);
    nodes.push({
      id,
      type: 'orchestrator',
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - ORCH_HEIGHT / 2 },
      data: {
        label: id.charAt(0).toUpperCase() + id.slice(1),
        role: id.toUpperCase(),
        status: 'COMPLETED',
      },
    });
  }

  // Verifier node
  const vPos = g.node('verifier');
  nodes.push({
    id: 'verifier',
    type: 'orchestrator',
    position: { x: vPos.x - NODE_WIDTH / 2, y: vPos.y - ORCH_HEIGHT / 2 },
    data: { label: 'Verifier', role: 'VERIFIER', status: 'PENDING' },
  });

  // Task nodes
  for (const step of steps) {
    const pos = g.node(step.id);
    nodes.push({
      id: step.id,
      type: step.status === 'AWAITING_APPROVAL' ? 'approval' : 'agent',
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: {
        label: step.taskName ?? step.id,
        role: step.agentRole,
        status: step.status,
        toolCalls: step.toolCalls?.length ?? 0,
        duration: step.actualDuration,
        description: step.description,
      },
    });
  }

  // Edges with dynamic styling based on step statuses
  for (const e of g.edges()) {
    const sourceStep = steps.find(s => s.id === e.v);
    const targetStep = steps.find(s => s.id === e.w);
    const isActive = targetStep?.status === 'IN_PROGRESS';
    const isSourceFailed = sourceStep?.status === 'FAILED';
    const isComplete = sourceStep?.status === 'COMPLETED' && targetStep?.status === 'COMPLETED';

    edges.push({
      id: `${e.v}->${e.w}`,
      source: e.v,
      target: e.w,
      type: 'smoothstep',
      animated: isActive,
      style: {
        stroke: isSourceFailed
          ? '#ef4444'
          : isActive
            ? '#3b82f6'
            : isComplete
              ? '#22c55e'
              : '#94a3b8',
        strokeWidth: isActive ? 2.5 : 1.5,
      },
    });
  }

  return { nodes, edges };
}
