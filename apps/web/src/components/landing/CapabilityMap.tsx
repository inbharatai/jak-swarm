'use client';

import { useRef, useState, useEffect } from 'react';
import { motion, useInView, AnimatePresence } from 'framer-motion';

/* ─── Data ──────────────────────────────────────────────────────────────── */

const CAPABILITY_RINGS = [
  {
    ring: 'core',
    label: 'Core Agents',
    radius: 120,
    items: [
      { id: 'ceo', label: 'CEO', color: '#34d399', desc: 'Strategy, OKRs, coordination' },
      { id: 'cto', label: 'CTO', color: '#fbbf24', desc: 'Architecture, code review, tech stack' },
      { id: 'cmo', label: 'CMO', color: '#f472b6', desc: 'Campaigns, content, brand' },
      { id: 'eng', label: 'ENG', color: '#38bdf8', desc: 'Code generation, debugging, CI/CD' },
      { id: 'legal', label: 'LAW', color: '#c084fc', desc: 'Contracts, compliance, policy' },
      { id: 'mkt', label: 'MKT', color: '#fb923c', desc: 'Content, email, analytics' },
    ],
  },
  {
    ring: 'tools',
    label: 'Tool Layer',
    radius: 220,
    items: [
      { id: 'email-tool', label: 'Email', color: '#EA4335', desc: '10 tools: read, draft, send, search' },
      { id: 'calendar-tool', label: 'Calendar', color: '#4285F4', desc: '3 tools: events, availability' },
      { id: 'browser-tool', label: 'Browser', color: '#34d399', desc: '20 tools: navigate, click, screenshot' },
      { id: 'docs-tool', label: 'Docs', color: '#8B5CF6', desc: '16 tools: read, write, extract, PDF' },
      { id: 'crm-tool', label: 'CRM', color: '#F59E0B', desc: '14 tools: contacts, deals, scoring' },
      { id: 'research-tool', label: 'Search', color: '#06B6D4', desc: '6 tools: web, SEO, SERP' },
      { id: 'code-tool', label: 'Code', color: '#c084fc', desc: 'Generate, test, deploy' },
      { id: 'voice-tool', label: 'Voice', color: '#f472b6', desc: 'WebRTC real-time sessions' },
      { id: 'kb-tool', label: 'Memory', color: '#34d399', desc: '7 tools: store, retrieve, classify' },
      { id: 'ops-tool', label: 'Ops', color: '#fb923c', desc: 'Webhooks, file I/O, sandbox' },
      { id: 'sheets-tool', label: 'Sheets', color: '#10B981', desc: 'CSV, stats, reports' },
      { id: 'mcp-tool', label: 'MCP', color: '#38bdf8', desc: 'Runtime-loaded providers' },
    ],
  },
];

const CONNECTIONS = [
  { from: 'ceo', to: 'email-tool' },
  { from: 'ceo', to: 'calendar-tool' },
  { from: 'ceo', to: 'docs-tool' },
  { from: 'cto', to: 'code-tool' },
  { from: 'cto', to: 'browser-tool' },
  { from: 'cto', to: 'ops-tool' },
  { from: 'cmo', to: 'research-tool' },
  { from: 'cmo', to: 'crm-tool' },
  { from: 'eng', to: 'code-tool' },
  { from: 'eng', to: 'browser-tool' },
  { from: 'eng', to: 'ops-tool' },
  { from: 'legal', to: 'docs-tool' },
  { from: 'legal', to: 'email-tool' },
  { from: 'mkt', to: 'email-tool' },
  { from: 'mkt', to: 'crm-tool' },
  { from: 'mkt', to: 'research-tool' },
];

/* ─── Helpers ───────────────────────────────────────────────────────────── */

function getNodePosition(ring: typeof CAPABILITY_RINGS[number], index: number) {
  const angleStep = (2 * Math.PI) / ring.items.length;
  const angle = angleStep * index - Math.PI / 2;
  // Round to 3 decimal places so SSR + client string serialization match
  // exactly. Raw Math.cos/sin floats produce identical numbers but React's
  // attribute stringifier truncates them slightly differently on Node vs
  // browser (drift in the 14th decimal) — firing a hydration warning +
  // dev overlay on every page load.
  return {
    x: Number((Math.cos(angle) * ring.radius).toFixed(3)),
    y: Number((Math.sin(angle) * ring.radius).toFixed(3)),
  };
}

function findNodePos(id: string): { x: number; y: number } {
  for (const ring of CAPABILITY_RINGS) {
    const idx = ring.items.findIndex((item) => item.id === id);
    if (idx !== -1) return getNodePosition(ring, idx);
  }
  return { x: 0, y: 0 };
}

/* ─── Component ─────────────────────────────────────────────────────────── */

export default function CapabilityMap() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: false, amount: 0.2 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredInfo, setHoveredInfo] = useState<{ label: string; desc: string; color: string } | null>(null);

  // Find connections related to hovered node
  const activeConnections = hoveredNode
    ? CONNECTIONS.filter((c) => c.from === hoveredNode || c.to === hoveredNode)
    : [];
  const connectedIds = new Set(activeConnections.flatMap((c) => [c.from, c.to]));

  const svgSize = 600;
  const center = svgSize / 2;

  return (
    <section
      ref={ref}
      className="relative px-4 py-16 sm:py-32 sm:px-6 lg:px-8 overflow-hidden"
      aria-label="Capability Architecture Map"
    >
      {/* Background radial */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 50%, rgba(52,211,153,0.04) 0%, transparent 50%)',
        }}
        aria-hidden="true"
      />

      <div className="mx-auto max-w-6xl relative z-10">
        {/* Section header */}
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <p className="text-sm font-semibold uppercase tracking-widest text-pink-400 mb-3 font-sans">Architecture</p>
          <h2 className="text-3xl font-display font-bold sm:text-5xl tracking-tight leading-[1.25] pb-2 text-balance">
            38 agents. 119 tools. One platform.
          </h2>
          <p className="mt-5 text-slate-400 max-w-2xl mx-auto font-sans text-base sm:text-lg leading-relaxed">
            Every agent wires into the exact tools it needs &mdash; no glue code, no duct tape.
            <span className="block mt-1 text-xs sm:text-sm text-slate-500">Tap or hover any node to trace the graph.</span>
          </p>
        </motion.div>

        {/* Interactive map */}
        <div className="relative mx-auto flex items-center justify-center" style={{ maxWidth: svgSize }}>
          <svg
            viewBox={`0 0 ${svgSize} ${svgSize}`}
            className="w-full h-auto"
            style={{ maxHeight: '70vh' }}
          >
            {/* Ring guides */}
            {CAPABILITY_RINGS.map((ring) => (
              <circle
                key={ring.ring}
                cx={center} cy={center}
                r={ring.radius}
                fill="none"
                stroke="rgba(255,255,255,0.03)"
                strokeWidth="1"
                strokeDasharray={ring.ring === 'tools' ? '2 6' : 'none'}
              />
            ))}

            {/* Connection lines */}
            {CONNECTIONS.map((conn, i) => {
              const from = findNodePos(conn.from);
              const to = findNodePos(conn.to);
              const isActive = activeConnections.some(
                (c) => c.from === conn.from && c.to === conn.to
              );

              return (
                <line
                  key={i}
                  x1={center + from.x}
                  y1={center + from.y}
                  x2={center + to.x}
                  y2={center + to.y}
                  stroke={isActive ? 'rgba(52,211,153,0.4)' : 'rgba(255,255,255,0.02)'}
                  strokeWidth={isActive ? 1.5 : 0.5}
                  style={{ transition: 'stroke 0.3s ease, stroke-width 0.3s ease' }}
                />
              );
            })}

            {/* Center node */}
            <g>
              <circle
                cx={center} cy={center} r="30"
                fill="rgba(52,211,153,0.08)"
                stroke="rgba(52,211,153,0.25)"
                strokeWidth="1.5"
              />
              <circle
                cx={center} cy={center} r="18"
                fill="rgba(9,9,11,0.9)"
                stroke="rgba(52,211,153,0.15)"
                strokeWidth="1"
              />
              <text
                x={center} y={center + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="11"
                fontWeight="800"
                fontFamily="var(--font-display)"
                fill="#34d399"
              >
                JAK
              </text>
            </g>

            {/* Ring labels — offset above the top node of each ring so they never overlap */}
            {CAPABILITY_RINGS.map((ring) => {
              const nodeSize = ring.ring === 'core' ? 22 : 16;
              return (
                <text
                  key={ring.ring}
                  x={center}
                  y={center - ring.radius - nodeSize - 14}
                  textAnchor="middle"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                  fill="rgba(255,255,255,0.22)"
                  letterSpacing="2.5"
                >
                  {ring.label.toUpperCase()}
                </text>
              );
            })}

            {/* Nodes */}
            {CAPABILITY_RINGS.map((ring) =>
              ring.items.map((item, i) => {
                const pos = getNodePosition(ring, i);
                const isHovered = hoveredNode === item.id;
                const isConnected = connectedIds.has(item.id);
                const dimmed = hoveredNode !== null && !isHovered && !isConnected;
                const nodeSize = ring.ring === 'core' ? 22 : 16;

                return (
                  <g
                    key={item.id}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => {
                      setHoveredNode(item.id);
                      setHoveredInfo({ label: item.label, desc: item.desc, color: item.color });
                    }}
                    onMouseLeave={() => {
                      setHoveredNode(null);
                      setHoveredInfo(null);
                    }}
                  >
                    {/* Glow */}
                    {(isHovered || isConnected) && (
                      <circle
                        cx={center + pos.x}
                        cy={center + pos.y}
                        r={nodeSize + 8}
                        fill={`${item.color}08`}
                        style={{ transition: 'all 0.3s ease' }}
                      />
                    )}

                    {/* Node circle */}
                    <circle
                      cx={center + pos.x}
                      cy={center + pos.y}
                      r={nodeSize}
                      fill={isHovered ? `${item.color}25` : dimmed ? 'rgba(255,255,255,0.01)' : `${item.color}10`}
                      stroke={isHovered ? `${item.color}70` : dimmed ? 'rgba(255,255,255,0.03)' : `${item.color}30`}
                      strokeWidth={isHovered ? 2 : 1}
                      style={{ transition: 'all 0.3s ease' }}
                    />

                    {/* Label */}
                    <text
                      x={center + pos.x}
                      y={center + pos.y + 1}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={ring.ring === 'core' ? '8' : '7'}
                      fontWeight="700"
                      fontFamily="var(--font-mono)"
                      letterSpacing="0.5"
                      fill={dimmed ? 'rgba(255,255,255,0.1)' : item.color}
                      style={{ transition: 'fill 0.3s ease' }}
                    >
                      {item.label}
                    </text>
                  </g>
                );
              })
            )}
          </svg>

          {/* Hover tooltip */}
          <AnimatePresence>
            {hoveredInfo && (
              <motion.div
                className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-xl px-5 py-3 pointer-events-none"
                style={{
                  background: 'rgba(9,9,11,0.9)',
                  border: `1px solid ${hoveredInfo.color}30`,
                  backdropFilter: 'blur(12px)',
                }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.2 }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: hoveredInfo.color }}
                  />
                  <span className="text-sm font-display font-semibold text-white">
                    {hoveredInfo.label}
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-sans">{hoveredInfo.desc}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Ring legend */}
        <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-8 mt-6 sm:mt-8 text-[10px] sm:text-xs font-mono text-slate-500">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full border border-emerald-400/30 bg-emerald-400/10" />
            <span>Core Agents (6)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full border border-white/10 bg-white/5" />
            <span>Tool Categories (12)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-px bg-emerald-400/30" />
            <span>Connections</span>
          </div>
        </div>
      </div>
    </section>
  );
}
