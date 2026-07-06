'use client';

// ─── Swarm Inspector route ───────────────────────────────────────────────────
//
// Phase B: the route now mounts the JARVIS Swarm Inspector — a dark-only,
// real-time command surface (left run rail · center tabbed drawer · right
// live event feed + approval gate, with a KPI bar on top). All run-list
// concerns (pagination, virtualization, filtering, hover prefetch) moved
// into <RunRail />; SSE is opened for the selected run only. See
// components/swarm/SwarmInspector.tsx.

import { SwarmInspector } from '@/components/swarm/SwarmInspector';

export default function SwarmPage() {
  return <SwarmInspector />;
}