'use client';

/**
 * External Auditor — audit run review page (Sprint 2.6).
 *
 * Shows the audit run + its workpapers. Workpapers can be approved /
 * rejected / request-changes if the engagement scopes include
 * 'decide_workpapers'. Free-form comments can be posted to the audit
 * trail if the scope includes 'comment'.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

const STORAGE_KEY = 'jak_auditor_token';
const ENGAGEMENT_KEY = 'jak_auditor_engagement';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || 'http://localhost:4000';

interface Workpaper {
  id: string;
  title?: string;
  controlId?: string;
  status: string;
  artifactId?: string;
  createdAt?: string;
}

interface AuditRun {
  id: string;
  framework?: string;
  status?: string;
  periodStart?: string;
  periodEnd?: string;
}

async function auditorFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  if (!token) throw new Error('Not signed in as auditor — accept your invite link first.');
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `HTTP ${res.status}`);
  }
  const json = await res.json();
  return json.data as T;
}

export default function AuditorRunReviewPage() {
  const params = useParams<{ id: string }>();
  const auditRunId = params?.id ?? '';

  const [run, setRun] = useState<AuditRun | null>(null);
  const [workpapers, setWorkpapers] = useState<Workpaper[] | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scopes, setScopes] = useState<string[]>([]);

  useEffect(() => {
    if (!auditRunId) return;
    try {
      const stored = localStorage.getItem(ENGAGEMENT_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as { scopes?: string[] };
        setScopes(parsed.scopes ?? []);
      }
    } catch { /* noop */ }
    auditorFetch<{ auditRun: AuditRun }>(`/auditor/runs/${auditRunId}`)
      .then((res) => setRun(res.auditRun))
      .catch((err: Error) => setError(err.message));
    auditorFetch<{ workpapers: Workpaper[] }>(`/auditor/runs/${auditRunId}/workpapers`)
      .then((res) => setWorkpapers(res.workpapers))
      .catch((err: Error) => setError(err.message));
  }, [auditRunId]);

  const decide = async (wpId: string, decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES') => {
    setBusy(true);
    setError('');
    try {
      await auditorFetch<{ workpaper: Workpaper }>(
        `/auditor/runs/${auditRunId}/workpapers/${wpId}/decide`,
        {
          method: 'POST',
          body: JSON.stringify({ decision, comment: comment.trim() || undefined }),
        },
      );
      // Refresh
      const res = await auditorFetch<{ workpapers: Workpaper[] }>(`/auditor/runs/${auditRunId}/workpapers`);
      setWorkpapers(res.workpapers);
      setComment('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decision failed');
    } finally {
      setBusy(false);
    }
  };

  const postComment = async () => {
    if (!comment.trim()) return;
    setBusy(true);
    setError('');
    try {
      await auditorFetch<{ logged: boolean }>(`/auditor/runs/${auditRunId}/comment`, {
        method: 'POST',
        body: JSON.stringify({ comment: comment.trim() }),
      });
      setComment('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comment failed');
    } finally {
      setBusy(false);
    }
  };

  const canDecide = scopes.includes('decide_workpapers');
  const canComment = scopes.includes('comment');

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div>
          <Link href="/auditor/runs" className="text-xs text-zinc-500 hover:text-zinc-300">
            ← All engagements
          </Link>
          <h1 className="text-lg font-semibold mt-1">Audit Run Review</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 rounded-md border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <section className="mb-8 rounded-md border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide mb-2">Run</h2>
          {!run && <p className="text-zinc-500 text-sm">Loading audit run&hellip;</p>}
          {run && (
            <dl className="text-sm grid grid-cols-2 gap-3">
              <div><dt className="text-zinc-500">ID</dt><dd>{run.id}</dd></div>
              {run.framework && <div><dt className="text-zinc-500">Framework</dt><dd>{run.framework}</dd></div>}
              {run.status && <div><dt className="text-zinc-500">Status</dt><dd>{run.status}</dd></div>}
              {run.periodStart && <div><dt className="text-zinc-500">Period start</dt><dd>{new Date(run.periodStart).toLocaleDateString()}</dd></div>}
              {run.periodEnd && <div><dt className="text-zinc-500">Period end</dt><dd>{new Date(run.periodEnd).toLocaleDateString()}</dd></div>}
            </dl>
          )}
          <p className="mt-3 text-xs text-zinc-500">
            Your scopes: {scopes.length > 0 ? scopes.join(', ') : '(read-only)'}
          </p>
        </section>

        <section>
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide mb-3">Workpapers</h2>
          {!workpapers && <p className="text-zinc-500 text-sm">Loading workpapers&hellip;</p>}
          {workpapers && workpapers.length === 0 && (
            <p className="text-zinc-500 text-sm">No workpapers generated yet.</p>
          )}
          {workpapers && workpapers.length > 0 && (
            <ul className="space-y-3">
              {workpapers.map((wp) => (
                <li key={wp.id} className="rounded-md border border-zinc-800 bg-zinc-900 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{wp.title ?? wp.controlId ?? wp.id}</p>
                      <p className="text-xs text-zinc-500 mt-1">
                        Status: <span className="text-zinc-300">{wp.status}</span>
                        {wp.controlId && <> &middot; Control: {wp.controlId}</>}
                      </p>
                    </div>
                    {canDecide && (
                      <div className="flex gap-2">
                        <button
                          disabled={busy}
                          onClick={() => decide(wp.id, 'APPROVE')}
                          className="px-3 py-1.5 text-xs rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => decide(wp.id, 'REQUEST_CHANGES')}
                          className="px-3 py-1.5 text-xs rounded bg-amber-700 hover:bg-amber-600 disabled:opacity-50"
                        >
                          Request changes
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => decide(wp.id, 'REJECT')}
                          className="px-3 py-1.5 text-xs rounded bg-red-700 hover:bg-red-600 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {canComment && (
          <section className="mt-8">
            <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide mb-3">Comment / Decision Note</h2>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder="Optional note. Attached to your next decision OR posted standalone via the button below."
              className="w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-sm focus:border-zinc-600 outline-none"
            />
            <button
              disabled={busy || !comment.trim()}
              onClick={postComment}
              className="mt-2 px-4 py-2 text-xs rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50"
            >
              Post comment to audit trail
            </button>
          </section>
        )}

        <p className="mt-10 text-xs text-zinc-600">
          Every action above is logged immutably to the engagement audit trail
          and visible to the tenant administrator.
        </p>
      </main>
    </div>
  );
}
