# JAK Swarm — Region & Caching Strategy

Investigation into the ~489ms Postgres query latency observed in production
(`/ready` reports `database.latencyMs = 489`) and options for cutting it.

**TL;DR**: the latency is real, it's from Supabase-Tokyo ↔ Render-Oregon
(~120ms RTT × ~4 round-trips per ready check), and there are three paths
to fix it in order of cost:

1. **Add Vercel Edge Cache to the frontend's read-heavy routes** — cuts
   user-perceived latency by 100-200ms for returning users. Code change only.
   **~2 hrs.** Recommended first.
2. **Move Render API to Singapore** (`singapore`, ~70ms to Tokyo vs 120ms
   from Oregon) — cuts API↔DB latency by 40%. Config-only on Render.
   **~30 min + a brief deploy window.** Recommended second.
3. **Migrate Supabase to a US region + keep Render Oregon** — cuts latency
   by 80%+ but requires a full DB migration (dump + restore + re-wire).
   **~1 day + potential downtime.** Only if 1+2 aren't enough.

---

## Current state

| Component | Region | RTT to Render Oregon |
|---|---|---|
| `jak-swarm-api` (Render) | `oregon` (us-west-2-ish) | 0 |
| `jak-swarm-worker` (Render) | `oregon` | 0 (same project) |
| Upstash Redis (`hardy-mustang-97756`) | Auto-detected (`/ready` shows 1ms) | ~1-5ms |
| Supabase Postgres (`ttrhawuqydfecndehdhx`) | `ap-northeast-1` (Tokyo) | **~120ms** |
| Vercel frontend (`apps/web`) | Edge network, default to user-nearest | varies |

**Evidence** from live `/ready` probe (2026-04-20):
```json
{
  "database":    { "status": "ok", "latencyMs": 489 },
  "redis":       { "status": "ok", "latencyMs": 1 },
  "llm_openai":  { "status": "healthy", "latencyMs": 373 },
  "llm_anthropic":{ "status": "healthy", "latencyMs": 27 },
  "llm_google":  { "status": "healthy", "latencyMs": 144 }
}
```

489ms for a simple `SELECT 1` against the DB is pure network — Prisma
through pgBouncer takes ~4 RTTs for a fresh probe (TCP + TLS handshake +
SQL round-trip). At 120ms RTT, 4 × 120 = 480ms lines up exactly.

## Why this matters

- Every agent tool call that writes state (workflow update, trace append,
  approval decision) pays 120ms × 2 = 240ms minimum.
- A Vibe Coder flow that does 20 writes across the workflow pays 20 × 240 =
  4.8 seconds just on DB latency, on top of LLM calls.
- User-visible: every page load that SSRs via the Render API pays 120-500ms
  before the first byte ships.
- Worker poll: every queue poll is `SELECT ... FOR UPDATE SKIP LOCKED`,
  and running at 1-second intervals (configured) means 120ms of every
  second is just waiting for Tokyo to respond.

Pre-launch with 23 users it's fine. At 500+ active users it becomes
noticeable. At 5000+ it becomes the reason users churn.

---

## Option 1 — Vercel Edge Cache on read-heavy routes

**What**: add `next: { revalidate: N }` or explicit `Cache-Control` headers
on the frontend routes that fetch from the Render API. Vercel's edge cache
stores the response on a CDN node near the user, so subsequent requests
skip Render + Supabase entirely.

**What gets cached**:
- `/api/tools/manifest` — tool registry, changes on deploy only
- `/api/roles/manifest` — same
- Public marketing pages (already static)
- Pricing page
- Integration list (per-tenant — cacheable with tenant-scoped cache key)

**What does NOT get cached** (correctness requires fresh):
- Workflow state (mid-flight, changes every second)
- Traces / logs (live)
- User profile + session
- Anything behind an approval gate

**How**: add `export const revalidate = 300` in each `apps/web/src/app/.../page.tsx`
that reads static-ish data. For API-route-based reads, use Next.js
`unstable_cache()` wrapping the fetcher.

**Effort**: ~2 hrs for the 5-10 routes that dominate traffic.
**Impact**: returning-visit latency drops from 400-600ms to <100ms for
cached routes. First-visit unchanged.

**Risk**: cache staleness on tenants changing their integration list.
Mitigate with per-tenant cache tags and explicit `revalidateTag()` on
integration connect/disconnect.

**Code shape**:

```tsx
// apps/web/src/app/(dashboard)/integrations/page.tsx
import { unstable_cache } from 'next/cache';

const getIntegrations = unstable_cache(
  async (tenantId: string) => {
    const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/integrations`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return r.json();
  },
  ['integrations'],
  { tags: ['integrations'], revalidate: 300 }
);
```

---

## Option 2 — Move Render API + Worker to Singapore

**What**: change the Render region from `oregon` to `singapore` on both
services. Singapore ↔ Tokyo is ~70ms RTT vs Oregon ↔ Tokyo ~120ms — a 40%
cut.

**How**: in the Render dashboard, Settings → Region → Singapore. Render
doesn't migrate services — you'd re-create them in Singapore + delete
Oregon. `render.yaml` change: `region: oregon` → `region: singapore` on
both service blocks.

**Caveats**:
1. **Render's Singapore region** supports all plan types but has a slightly
   smaller available machine catalog. Verify `starter` is available.
2. **Downtime**: re-creating a service means brief downtime. Do this at
   a low-traffic window + have a rollback plan (keep the Oregon service
   suspended for 48 hrs before deleting).
3. **Redis co-location**: Upstash Redis is auto-regioned by the Upstash
   UI. When you create a new DB they let you pick region. Current
   `hardy-mustang-97756` is in whatever region you picked — if it's
   Oregon-adjacent, the benefit is partially offset until you move
   Upstash to Singapore too. Upstash doesn't migrate; you re-create.
4. **Frontend → API latency**: users in US + EU will pay +150ms to reach
   a Singapore API. Vercel's edge caching (Option 1) absorbs most of
   that. Users in Asia + India (your market) benefit most.

**Effort**: ~30 min Render config + ~30 min Upstash migration + ~30 min
smoke-test = ~2 hrs total.
**Impact**: DB latency drops from 489ms to ~280ms. Worker poll overhead
cuts proportionally.

**Recommendation**: do this IF your target users are in Asia / India.
For a US-first launch, skip this and keep Oregon.

---

## Option 3 — Migrate Supabase to a US region

**What**: provision a new Supabase project in us-west-2 or us-east-1
(~5-20ms to Render Oregon), dump the current Tokyo DB, restore to the
new project, re-wire `DATABASE_URL` + `DIRECT_URL` + Supabase Auth URL
in Render and Vercel.

**How** (sketch):
1. Create new Supabase project in target region.
2. `pg_dump` from old → `pg_restore` to new. 23 users + 13 tenants right
   now = <100MB = <2 min dump/restore.
3. Export Supabase Auth users (via Supabase Management API — users are
   in the `auth.users` table of the source project).
4. Re-point env vars on Render + Vercel to the new URLs.
5. Re-send confirm emails to all 23 users (they need to re-verify
   sessions bound to the old project).
6. Delete old project after 7-day retention window.

**Caveats**:
1. **Downtime**: ~15-30 minutes while you cut DNS + env vars.
2. **User sessions invalidated**: everyone logs in again.
3. **Pricing**: new Supabase project needs its own Pro plan ($25/mo) if
   you're on Pro now.
4. **Storage / Realtime**: if you're using Supabase Storage or Realtime,
   those also need to move.

**Effort**: ~1 day including dry-run migration + user-comms + cutover.
**Impact**: DB latency drops from 489ms to ~20-40ms. **10× improvement.**

**Recommendation**: do this ONLY if Option 1 + 2 don't get you under
200ms p95, and you're at >500 active users where the latency is hurting.
At 23 users it's premature optimization — but bank it as the plan for
later.

---

## Vercel edge-caching config I'll add when you green-light Option 1

The committed code change will add:

1. `apps/web/src/app/(dashboard)/integrations/page.tsx` — `unstable_cache`
   with `tags: ['integrations', \`tenant-\${tenantId}\`]`, 5-minute revalidate
2. `apps/web/src/app/(marketing)/pricing/page.tsx` — `export const revalidate = 3600`
3. `apps/web/src/app/(dashboard)/tools/page.tsx` — `revalidate: 600`
4. `apps/web/src/lib/api-client.ts` — add a `cache: 'force-cache' | 'no-store'`
   parameter so callers opt into caching explicitly rather than by default
5. `apps/api/src/routes/tools.routes.ts` + `roles.routes.ts` — emit
   `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`
   on GET manifest routes, so Vercel's fetch cache can honor it

---

## What this doc is not

It's not a commitment to execute. Each option has a clear "when to do it"
trigger — at 23 users + pre-launch, **none of these are urgent**. The
document exists so that when your user load makes the latency matter, the
decision is already researched.

**First latency complaint from a user in Asia** → do Option 1 + 2 the
same day.
**Latency becoming the retention driver** → do Option 3.
