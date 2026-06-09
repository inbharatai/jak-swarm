# JAK Swarm — Deployment Runbook (P0-A fix sprint)

> Legacy note: this runbook documents the old Render API/worker deployment. The primary deployment is now Google Cloud Run (`jak-swarm-api`), with Railway as rollback/fallback. Vercel frontend, Supabase Postgres, and Railway managed Redis. Use [`docs/DEPLOYMENT_GOOGLE_CLOUD_RUN.md`](DEPLOYMENT_GOOGLE_CLOUD_RUN.md) for Cloud Run setup and [`docs/railway-deployment.md`](railway-deployment.md) for the Railway runbook.

This doc replaces the implicit knowledge that the live `jakswarm.com`
deploy was missing — specifically why the dashboard buttons were calling
`localhost:4000` from a browser running on a customer's machine.

## Topology

```
Browser
  │
  ▼
Vercel (apps/web — Next.js)
  │   reads NEXT_PUBLIC_API_URL at build time
  ▼
Render: jak-swarm-api (web service, public)
  │   handles HTTP / SSE / auth / enqueue
  ▼
Render: jak-swarm-worker (private service)
  │   drains the queue
  ▼
Supabase Postgres + Upstash Redis
```

Frontend = **Vercel**. API + worker = **Render** (per `render.yaml`).
State = Supabase + Upstash. **Both Render services share the same DB
and Redis.**

## P0-A: required env vars

### Vercel project (apps/web)

| Var | Required for | Example |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | **Production** | `https://jak-swarm-api.onrender.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | All envs | `https://xyz.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All envs | `eyJ...` |

If `NEXT_PUBLIC_API_URL` is missing **or** points at `localhost`, the
production build will:

1. Log a console error on every page load.
2. Reject every dashboard fetch with status 503 + `MISCONFIGURED_API_URL`.
3. Surface a "Backend not configured" banner instead of silent failures.

This is intentional. The previous behavior (silent fallback to
`http://localhost:4000`) was the verified blocker called out in the
Round 2 adversarial audit.

### Render `jak-swarm-api`

Set in the Render dashboard (per `render.yaml` `sync: false` entries):

- `DATABASE_URL`, `DIRECT_URL` — Supabase pooler + direct
- `AUTH_SECRET` — JWT signing secret
- `REDIS_URL` — Upstash `rediss://` URL
- `OPENAI_API_KEY` — required OpenAI-only LLM runtime
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — for auth verification
- `WORKFLOW_WORKER_MODE=standalone` — disables the in-API worker (the
  separate `jak-swarm-worker` service drains the queue)
- Optional: `JAK_AGENT_TRACE_RETENTION_DAYS=90` — overrides default
  AgentTrace retention window (P0-B follow-on)

### Render `jak-swarm-worker`

Same secrets as `jak-swarm-api` plus:

- `WORKFLOW_WORKER_MODE=worker` — enables queue drain
- (No public HTTP port — pserv only)

## Deployment sequence

1. **Rotate** any chat-leaked credentials before the first deploy
   (Supabase service_role key, Render API key, Upstash credential).
2. **Apply the Render blueprint:** `render blueprint launch` from the
   repo root, or push to a connected branch with `autoDeploy: true`.
3. **Set Render secrets** in the dashboard for every `sync: false` env
   var listed above.
4. **Wait for `jak-swarm-api` health-check** — Render polls
   `/healthz` and only marks the service Live after a 200 response.
5. **Set `NEXT_PUBLIC_API_URL`** in the Vercel project env vars to the
   `jak-swarm-api` URL (e.g. `https://jak-swarm-api.onrender.com`).
6. **Trigger a Vercel redeploy** so the new env var is baked into the
   client bundle.
7. **Smoke test:**
   ```bash
   # 1. API health
   curl -fsS https://jak-swarm-api.onrender.com/healthz

   # 2. Frontend baked the right API URL (look for it in the JS bundles)
   curl -s https://jakswarm.com/_next/static/chunks/main-*.js | grep -oE 'jak-swarm-api[a-zA-Z0-9./:-]*'

   # 3. Dashboard call (should NOT 503 with MISCONFIGURED_API_URL)
   #    Open https://jakswarm.com/social-drafts in the browser and try
   #    a Generate. Network tab should show the request going to the
   #    Render URL, NOT to localhost:4000.
   ```

## Verifying the P0-A fix locally

```bash
# Production build with no NEXT_PUBLIC_API_URL — should fail loud at run time
cd apps/web && pnpm run build && NODE_ENV=production pnpm start
# Open http://localhost:3000/social-drafts in browser:
#   - DevTools console: "[api-client] Production-build misconfiguration..."
#   - Generate button click: 503 MISCONFIGURED_API_URL toast
#   - NO fetch to http://localhost:4000

# Production build WITH the var set
NEXT_PUBLIC_API_URL=https://jak-swarm-api.onrender.com cd apps/web && pnpm run build
# Same flow — no console error, fetches go to the configured URL.
```

## Runtime validation checklist

After every production deploy, run these before declaring the deploy good:

- [ ] `curl -fsS https://jak-swarm-api.onrender.com/healthz` returns 200
- [ ] Frontend JS bundle contains the Render URL (not `localhost:4000`)
- [ ] Browser network tab on `/social-drafts` shows requests going to the
  Render URL, not localhost
- [ ] No `MISCONFIGURED_API_URL` errors in browser console on the
  dashboard pages
- [ ] At least one real workflow succeeds end-to-end (login → command →
  approval → audit log row)

If any of these fail, the deploy is **not** ready for paid customers.
