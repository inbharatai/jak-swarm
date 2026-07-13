'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient, getErrorMessage } from '@/lib/api-client';

type Entity = {
  id: string;
  entityType: string;
  title: string;
  summary: string;
  status: string;
  ownerName: string | null;
  priority: string | null;
  confidence: number;
  dueAt: string | null;
};

type Edge = {
  id: string;
  sourceEntityId: string;
  relationshipType: string;
  targetEntityId: string;
  status: string;
  confidence: number;
};

type Claim = {
  id: string;
  subjectEntityId: string;
  predicate: string;
  objectEntityId: string | null;
  objectValue: unknown;
  status: 'proposed' | 'active' | 'disputed' | 'superseded' | 'rejected';
  confidence: number;
  authorityScore: number;
};

type Review = {
  id: string;
  reviewType: 'claim' | 'entity_merge' | 'edge' | 'retention' | 'access';
  resourceId: string;
  reason: string;
  priority: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type GraphResponse = {
  entities: Entity[];
  edges: Edge[];
  claims: Claim[];
  openReviewCount: number;
};

type ApiEnvelope<T> = { success: true; data: T };

function unwrap<T>(payload: ApiEnvelope<T> | T): T {
  return payload && typeof payload === 'object' && 'success' in payload
    ? (payload as ApiEnvelope<T>).data
    : payload as T;
}

function valueText(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function nodePosition(index: number, total: number, width: number, height: number): { x: number; y: number } {
  const safeTotal = Math.max(total, 1);
  const angle = (Math.PI * 2 * index) / safeTotal - Math.PI / 2;
  const radiusX = Math.max(120, width * 0.38);
  const radiusY = Math.max(100, height * 0.34);
  return {
    x: width / 2 + Math.cos(angle) * radiusX,
    y: height / 2 + Math.sin(angle) * radiusY,
  };
}

export default function CompanyGraphPage() {
  const [graph, setGraph] = useState<GraphResponse>({ entities: [], edges: [], claims: [], openReviewCount: 0 });
  const [reviews, setReviews] = useState<Review[]>([]);
  const [query, setQuery] = useState('');
  const [entityType, setEntityType] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyReviewId, setBusyReviewId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('query', query.trim());
      if (entityType) params.set('entityType', entityType);
      params.set('limit', '200');
      const graphPayload = await apiClient.get<ApiEnvelope<GraphResponse>>(`/company/brain/graph?${params.toString()}`);
      const nextGraph = unwrap(graphPayload);
      setGraph(nextGraph);
      const reviewPayload = await apiClient
        .get<ApiEnvelope<{ items: Review[] }>>('/company/brain/reviews?status=open&limit=100&offset=0')
        .catch(() => null);
      setReviews(reviewPayload ? unwrap(reviewPayload).items : []);
      setSelectedId((current) => current && nextGraph.entities.some((entity) => entity.id === current)
        ? current
        : nextGraph.entities[0]?.id ?? null);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [entityType, query]);

  useEffect(() => { void load(); }, [load]);

  const entityById = useMemo(() => new Map(graph.entities.map((entity) => [entity.id, entity])), [graph.entities]);
  const selected = selectedId ? entityById.get(selectedId) ?? null : null;
  const selectedClaims = selected
    ? graph.claims.filter((claim) => claim.subjectEntityId === selected.id)
    : [];
  const selectedEdges = selected
    ? graph.edges.filter((edge) => edge.sourceEntityId === selected.id || edge.targetEntityId === selected.id)
    : [];
  const entityTypes = useMemo(() => [...new Set(graph.entities.map((entity) => entity.entityType))].sort(), [graph.entities]);

  const width = 1000;
  const height = 620;
  const positions = useMemo(() => new Map(graph.entities.map((entity, index) => [entity.id, nodePosition(index, graph.entities.length, width, height)])), [graph.entities]);

  async function decideClaim(review: Review, decision: 'APPROVED' | 'REJECTED') {
    if (review.reviewType !== 'claim') return;
    setBusyReviewId(review.id);
    setError(null);
    try {
      await apiClient.post(`/company/brain/claims/${review.resourceId}/decide`, {
        decision,
        comment: decision === 'APPROVED' ? 'Approved from Company Brain review queue.' : 'Rejected from Company Brain review queue.',
      });
      await load();
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusyReviewId(null);
    }
  }

  async function approveMerge(review: Review) {
    if (review.reviewType !== 'entity_merge') return;
    const targetEntityId = typeof review.payload?.targetEntityId === 'string' ? review.payload.targetEntityId : null;
    if (!targetEntityId) {
      setError('Merge review is missing its target entity.');
      return;
    }
    setBusyReviewId(review.id);
    setError(null);
    try {
      await apiClient.post(`/company/brain/entities/${review.resourceId}/merge`, {
        targetEntityId,
        reason: review.reason,
        similarity: typeof review.payload?.similarity === 'number' ? review.payload.similarity : undefined,
      });
      await load();
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusyReviewId(null);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-6 md:px-8">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <header className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">JAK Company Brain</p>
            <h1 className="mt-1 text-2xl font-semibold">Evidence graph and organisational truth</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Canonical entities, typed relationships, evidence-backed claims, conflicts and human review. Hyperagents receive permission-filtered slices of this graph instead of raw company data.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-full border px-3 py-1">{graph.entities.length} entities</span>
            <span className="rounded-full border px-3 py-1">{graph.edges.length} edges</span>
            <span className="rounded-full border px-3 py-1">{graph.claims.length} claims</span>
            <span className="rounded-full border px-3 py-1">{graph.openReviewCount} reviews</span>
          </div>
        </header>

        <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4 md:flex-row">
          <input
            value={query}
            onChange={(event: { target: { value: string } }) => setQuery(event.target.value)}
            onKeyDown={(event: { key: string }) => { if (event.key === 'Enter') void load(); }}
            placeholder="Search customers, projects, decisions, risks…"
            className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <select
            value={entityType}
            onChange={(event: { target: { value: string } }) => setEntityType(event.target.value)}
            className="rounded-lg border bg-background px-3 py-2 text-sm"
          >
            <option value="">All entity types</option>
            {entityTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <button onClick={() => void load()} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60" disabled={loading}>
            {loading ? 'Loading…' : 'Refresh graph'}
          </button>
        </section>

        {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
          <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="border-b px-4 py-3 text-sm font-medium">Living company graph</div>
            {graph.entities.length === 0 && !loading ? (
              <div className="p-12 text-center text-sm text-muted-foreground">No graph entities match this view. Add or sync company evidence, then process the artifact.</div>
            ) : (
              <div className="overflow-auto bg-muted/20">
                <svg viewBox={`0 0 ${width} ${height}`} className="min-h-[620px] min-w-[900px] w-full" role="img" aria-label="Company knowledge graph">
                  <defs>
                    <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                      <path d="M0,0 L0,8 L8,4 z" className="fill-muted-foreground" />
                    </marker>
                  </defs>
                  {graph.edges.map((edge) => {
                    const source = positions.get(edge.sourceEntityId);
                    const target = positions.get(edge.targetEntityId);
                    if (!source || !target) return null;
                    const midX = (source.x + target.x) / 2;
                    const midY = (source.y + target.y) / 2;
                    return (
                      <g key={edge.id}>
                        <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} className="stroke-muted-foreground/50" strokeWidth="1.5" markerEnd="url(#arrow)" />
                        <text x={midX} y={midY - 5} textAnchor="middle" className="fill-muted-foreground text-[10px]">{edge.relationshipType}</text>
                      </g>
                    );
                  })}
                  {graph.entities.map((entity) => {
                    const position = positions.get(entity.id);
                    if (!position) return null;
                    const active = selectedId === entity.id;
                    const disputed = graph.claims.some((claim) => claim.subjectEntityId === entity.id && claim.status === 'disputed');
                    return (
                      <g key={entity.id} transform={`translate(${position.x},${position.y})`} onClick={() => setSelectedId(entity.id)} className="cursor-pointer">
                        <circle r={active ? 42 : 36} className={active ? 'fill-primary stroke-primary' : disputed ? 'fill-amber-100 stroke-amber-600 dark:fill-amber-950' : 'fill-card stroke-border'} strokeWidth={active ? 3 : 2} />
                        <text y={-5} textAnchor="middle" className={active ? 'fill-primary-foreground text-[11px] font-semibold' : 'fill-foreground text-[11px] font-semibold'}>
                          {entity.title.length > 22 ? `${entity.title.slice(0, 20)}…` : entity.title}
                        </text>
                        <text y={12} textAnchor="middle" className={active ? 'fill-primary-foreground/80 text-[9px]' : 'fill-muted-foreground text-[9px]'}>{entity.entityType}</text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}
          </section>

          <aside className="space-y-5">
            <section className="rounded-2xl border bg-card p-4 shadow-sm">
              <h2 className="font-semibold">Selected entity</h2>
              {!selected ? <p className="mt-3 text-sm text-muted-foreground">Select a graph node.</p> : (
                <div className="mt-3 space-y-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border px-2 py-0.5 text-xs">{selected.entityType}</span>
                      {selected.priority && <span className="rounded-full border px-2 py-0.5 text-xs">{selected.priority}</span>}
                    </div>
                    <h3 className="mt-2 text-lg font-semibold">{selected.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{selected.summary}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-muted p-2"><span className="text-muted-foreground">Status</span><div className="font-medium">{selected.status}</div></div>
                    <div className="rounded-lg bg-muted p-2"><span className="text-muted-foreground">Confidence</span><div className="font-medium">{Math.round(selected.confidence * 100)}%</div></div>
                    <div className="rounded-lg bg-muted p-2"><span className="text-muted-foreground">Owner</span><div className="font-medium">{selected.ownerName ?? 'Unassigned'}</div></div>
                    <div className="rounded-lg bg-muted p-2"><span className="text-muted-foreground">Due</span><div className="font-medium">{selected.dueAt ? new Date(selected.dueAt).toLocaleDateString() : '—'}</div></div>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold">Claims</h4>
                    <div className="mt-2 space-y-2">
                      {selectedClaims.length === 0 && <p className="text-xs text-muted-foreground">No claims.</p>}
                      {selectedClaims.slice(0, 12).map((claim) => (
                        <div key={claim.id} className="rounded-lg border p-2 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{claim.predicate}</span>
                            <span className="rounded-full border px-2 py-0.5">{claim.status}</span>
                          </div>
                          <div className="mt-1 break-words text-muted-foreground">{valueText(claim.objectValue)}</div>
                          <div className="mt-1 text-[10px] text-muted-foreground">Authority {Math.round(claim.authorityScore * 100)}% · confidence {Math.round(claim.confidence * 100)}%</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold">Relationships</h4>
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {selectedEdges.length === 0 && <p>No relationships.</p>}
                      {selectedEdges.slice(0, 12).map((edge) => {
                        const outgoing = edge.sourceEntityId === selected.id;
                        const other = entityById.get(outgoing ? edge.targetEntityId : edge.sourceEntityId);
                        return <div key={edge.id}>{outgoing ? '→' : '←'} {edge.relationshipType} {other?.title ?? 'external entity'}</div>;
                      })}
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Truth review queue</h2>
                <span className="rounded-full border px-2 py-0.5 text-xs">{reviews.length}</span>
              </div>
              <div className="mt-3 max-h-[560px] space-y-3 overflow-auto pr-1">
                {reviews.length === 0 && <p className="text-sm text-muted-foreground">No unresolved memory reviews.</p>}
                {reviews.map((review) => (
                  <article key={review.id} className="rounded-xl border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-full border px-2 py-0.5 text-xs">{review.reviewType}</span>
                      <span className="text-xs text-muted-foreground">{review.priority}</span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{review.reason}</p>
                    {review.reviewType === 'claim' && (
                      <div className="mt-3 flex gap-2">
                        <button disabled={busyReviewId === review.id} onClick={() => void decideClaim(review, 'APPROVED')} className="flex-1 rounded-lg bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">Approve</button>
                        <button disabled={busyReviewId === review.id} onClick={() => void decideClaim(review, 'REJECTED')} className="flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium disabled:opacity-50">Reject</button>
                      </div>
                    )}
                    {review.reviewType === 'entity_merge' && (
                      <button disabled={busyReviewId === review.id} onClick={() => void approveMerge(review)} className="mt-3 w-full rounded-lg bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">Approve merge</button>
                    )}
                  </article>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
