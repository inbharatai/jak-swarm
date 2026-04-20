# JAK Swarm — Founder Action List

Ordered by risk first, then by blocking impact, then by effort. Each section names what the owner has to do — nobody else can.

Last reviewed: 2026-04-20.

---

## A. SECURITY (urgent — do now)

Three credentials have been pasted into Claude chat across the 2026-04-18 and 2026-04-20 sessions. All three are now in the session transcript permanently. Rotate all three before anything else — rotation is cheap, compromise is not.

### A1. Rotate the Supabase service_role key (leaked 2026-04-18)
- **Where**: Supabase Dashboard → Project Settings → API → "service_role" → "Regenerate"
- **Why**: Supabase is JAK's auth layer and database — a leaked service_role key gives admin access to every user and every table regardless of RLS
- **Blast if skipped**: attacker can forge sessions, reset any user password, read/write every row
- **Success check**: new key visible in Supabase UI; JAK API continues working (it only uses the anon key at runtime — verified)

### A2. Rotate the Render API key (leaked 2026-04-20, prefix `rnd_I38L…`)
- **Where**: Render Dashboard → Account Settings → API Keys (https://dashboard.render.com/account/api-keys) → find the key with that prefix → Revoke. Create a new key for automation scripts.
- **Why**: `rnd_*` keys grant FULL account access — any service can be created, deleted, or modified
- **Blast if skipped**: attacker can delete your prod services, exfiltrate all env-var secrets (DATABASE_URL, AUTH_SECRET, every LLM key)
- **Success check**: old key no longer listed; new key stored ONLY in password manager

### A3. Rotate the Upstash credential (leaked 2026-04-20, UUID `d364f4a4-d368-…`)
- **Where**: Upstash Console → Account → Management API (https://console.upstash.com/account/api) — revoke any token with that UUID. Additionally: your Redis DB → "Details" → "Reset Password" (rotates the password inside the `rediss://` URL).
- **Why**: depending on what it is, either the management API (can create/delete DBs) or the DB password itself (read/write Redis data including signal bus + distributed locks)
- **Blast if skipped**: attacker can flush your Redis (pause/resume/stop signals + SSE relay + distributed locks go with it), or inject fake messages on the signal bus
- **Success check**: after password reset, you have a new `rediss://default:NEW_PASS@host.upstash.io:6379` URL. Paste this as `REDIS_URL` on both Render services in step B below.

**Do NOT proceed to any other step in this document until A1 / A2 / A3 are all rotated.**

---

## B. Credentials (blocks specific capabilities)

Tool calls fail gracefully when keys are absent, but features stay gated until configured. Set these in the runtime env (or your secret manager of choice):

| Env var | Gates | Tier |
|---|---|---|
| `SERPER_API_KEY` | Production search primary — $5/mo, 2500 queries | Recommended |
| `TAVILY_API_KEY` | Search secondary / fallback chain | Recommended |
| `OPENAI_API_KEY` | GPT-4o tier-1 router, vision tools (browser_analyze_page, screenshot-to-code), DALL-E image gen | Required for tier-3 + vision |
| `ANTHROPIC_API_KEY` | Claude Opus tier-3 for Architect, Technical, Strategist roles | Required for depth on those roles |
| `GITHUB_PAT` | github_create_repo, github_push_files, github_review_pr | Required for GitHub sync |
| `VERCEL_TOKEN` | AppDeployer → production deployment | Required for deploy flow |
| `GMAIL_EMAIL` + `GMAIL_APP_PASSWORD` | IMAP + SMTP email tools | Required for email worker |
| CalDAV creds | Calendar worker | Optional |
| `BRAVE_API_KEY` | Brave MCP server | Optional |

DuckDuckGo scraping (free tier) runs without any key but quality is noticeably worse than Serper or Tavily; don't ship on it for serious users.

---

## C. Infrastructure (required before production traffic)

### C1. Postgres (pgvector) + Redis
Postgres powers the durable queue and workflow state. Redis powers the cross-instance signal bus and SSE relay. Without Redis, a pause signal from instance A is not seen by instance B — the workflow continues until the next DB poll.

### C2. Standalone worker-entry.ts process
Queue workers should run as their own process, deployed separately from the API. The queue + API in one process works for dev but not for production throughput — a stuck LLM call blocks API requests.

### C3. Sticky sessions OR Redis SSE relay (wired, needs configuration)
The Redis SSE relay is implemented. In production, either pin EventSource clients to the instance serving them (sticky sessions at the load balancer) or enable the Redis relay so any instance can fan-out to any SSE subscriber.

### C4. Prometheus + alerting endpoint
`/metrics` is exposed. You still need a Prometheus scrape job and alerts wired for: queue depth, approval-request age, worker lease expiry, LLM cost/hour.

### C5. Docker (optional — for bench-vibe-coder --docker)
`pnpm bench:vibe-coder --docker` runs a real `next build` inside node:20-slim per spec. Install Docker if you want this layer of verification. The bench runs without it (static TS compiler as deepest layer).

---

## D. Product / UX decisions (your voice, nobody else's)

### D1. ~~Shallow role upgrades~~ (closed 2026-04-20)
All 6 previously-shallow roles — Support, Ops, Voice, HR, Designer, Browser — were upgraded to 9/10+ depth on 2026-04-20. Each now has: expert-level prompt with non-negotiables + failure-mode guidance, domain-specific output schema, ≥3 domain tools, manual-review fallback on parse failure, and behavioral tests. Audit + tests in [tests/unit/agents/role-world-class-upgrades.test.ts](tests/unit/agents/role-world-class-upgrades.test.ts).

No remaining role falls below the 9/10 bar in the role manifest.

### D2. Screenshot-to-Code marketing
The agent is wired end-to-end through vibe-coding-execution.service.ts. The claim "Upload a UI design → AI generates matching React + Tailwind components" is true when tested. It needs a real-world end-to-end smoke with a complex Figma screenshot before external launch — owner to run + record.

### D3. Hero copy + pricing packaging
The positioning in `docs/competitive-positioning.md` is the honest identity. If you accept it, the landing page hero should be rewritten from "AI for everything" to operator-control-plane language. Pricing tiers should reflect it: a free tier with no approvals / no audit / no durable queue is fine as a hook, but the paid tier's value prop is "the things the free tier is missing."

### D4. Deprecated / legacy routes
`POST /projects/:id/rollback` and `GET /projects/:id/versions` are kept for back-compat. The new UI uses `/checkpoints`. Decide when to remove the old routes (probably when no external API consumers depend on them).

---

## E. Manual QA before launch

Nothing replaces these:

1. Three real Vibe Coder specs end-to-end:
   - Todo app (in-memory state)
   - Blog with Prisma + Postgres
   - CRUD REST API
   Each should complete, build, and deploy to Vercel. Record durations + debug-retry counts.

2. Kill a worker mid-run — verify another instance reclaims the job within 30s and completes it.

3. Approval flow on real browser — click approve, click reject, verify state transitions and reviewer attribution persist.

4. `code_execute` Python with `NODE_ENV=production` set → verify the guard fires and refuses to run.

5. Multi-tenant isolation — tenant A creates project P, tenant B tries to list/read/restore P's checkpoints. Verify 404 (not 403 — don't leak existence).

---

## F. Things to stop claiming until proven

- **"10x cheaper"** — until `pnpm bench:search` or `bench:vibe-coder` runs comparable workloads against a single-model platform with a published methodology, this stays off. It is NOT currently in the repo — don't add it.
- **"World-class"** applied generally — it's true of the 5 hero roles + the 4 upgraded in Session 8. It's not true of the rest. Pick one of D1's options.
- **"Production-ready"** as a blanket statement — rephrase as "production-ready with Postgres + Redis + a configured LLM provider" so the infra preconditions in C are implicit.

---

## G. Previously deferred work

Tracked here so it doesn't get lost.

### G1. P1b-ownership (Prisma migration)
Add `workflow_jobs.ownerInstanceId`, `leaseExpiresAt`, `lastHeartbeatAt`. Reclaim queue items when lease expires. Prevents a truly-dead worker from holding jobs indefinitely.

### G2. P2b-split (monolith cleanup)
`packages/tools/src/builtin/index.ts` is 5946 lines. Finish splitting into per-category files via the prep script at `scripts/split-builtin-tools.ts`. Not urgent — the file works — but it becomes the single point of merge conflicts.

### G3. Phase 7 cross-instance integration tests
Postgres-backed integration tests for: unpause-signal recovery across instances, approval resume, worker-lease recovery. These need Postgres + Redis in CI.

### G4. Session 7 tool maturity classification (closed)
Before Session 7, 40 of the 119 registered built-in tools had no maturity label and were bucketed as `unclassified` in the manifest. Closed in commit `faad80d` — all 119 tools now carry a maturity label. Within the 40-tool subset that was classified in that commit, the breakdown is **real: 17, heuristic: 12, llm_passthrough: 8, config_dependent: 2, experimental: 1** (total 40). `pnpm check:truth` runs `scripts/verify-session7-counts.ts` and fails CI if any of those 40 tools silently changes maturity or is removed from the registry.

### G5. Checkpoint-revert
Closed in Session 5 + 6. Backend service, routes, and UI timeline all shipped.

### G6. Docker-backed build check
Closed in Session 4. DockerBuildChecker + injectable runner + graceful skip.

### G7. Role depth upgrades (first 4)
Closed in Session 8. Email / CRM / Research / Calendar now have expert-mode schemas + behavioral tests.

---

## H. Render API+Worker split migration — step-by-step checklist

This is the exact order to go from the current single Render service (embedded worker) to the production topology (API + Worker + Grafana Agent). Read [docs/DEPLOYMENT.md](DEPLOYMENT.md) for context; this section is the execution plan.

Before starting: run `pnpm -w run bootstrap:prod-automation` (see [scripts/automation/README.md](../scripts/automation/README.md)) — this checks you have the rotated tokens from section A and installs prerequisites (curl, jq).

### Stage 1 — rotate leaked credentials (section A above)
1. Rotate Supabase service_role key (A1)
2. Rotate Render API key (A2) → save new key as `RENDER_API_KEY` env var for automation scripts
3. Rotate Upstash credential (A3) → save new `rediss://` URL

### Stage 2 — manual one-time Supabase + Upstash config (cannot automate cleanly)
4. **Supabase → Authentication → URL Configuration**:
   - Site URL: `https://jakswarm.com`
   - Redirect URLs: add `https://jakswarm.com/auth/callback`, `https://jakswarm.com/auth/confirm`, `https://www.jakswarm.com/auth/callback`, `https://www.jakswarm.com/auth/confirm`, `http://localhost:3000/auth/callback`, `http://localhost:3000/auth/confirm`
   - (Automation available: `pnpm -w run automation:supabase-redirects` — needs `SUPABASE_PROJECT_REF` + `SUPABASE_MANAGEMENT_TOKEN`)
5. **Upstash** → your Redis DB → copy the `rediss://default:...@host:6379` URL (post-rotation)

### Stage 3 — provision the Render worker + Grafana Agent
6. Run `pnpm -w run automation:provision-render-worker`. Needs these env vars set locally:
   - `RENDER_API_KEY` (from step 2)
   - `RENDER_OWNER_ID` (found at https://dashboard.render.com/u/settings/general under "Workspace ID")
   - `JAK_REPO_URL` (e.g. `https://github.com/inbharatai/jak-swarm`)
   - `JAK_REPO_BRANCH` (e.g. `main`)
   - The script creates `jak-swarm-worker` (pserv) and `jak-swarm-grafana-agent` (pserv) and returns their service IDs.
7. Run `pnpm -w run automation:sync-env-to-render -- jak-swarm-worker` with a local `.env.render-worker` file containing all the worker env vars from [DEPLOYMENT.md](DEPLOYMENT.md). Script uploads each as a secret.

### Stage 4 — flip the API to standalone mode
8. Run `pnpm -w run automation:sync-env-to-render -- jak-swarm-api` with a `.env.render-api` that includes `WORKFLOW_WORKER_MODE=standalone` and `REQUIRE_REDIS_IN_PROD=true`. This is the critical flip — do it AFTER the worker is live, not before.
9. Watch API logs: should now say `[Swarm] Queue worker disabled in API process (standalone mode expected)`

### Stage 5 — Vercel frontend env sync
10. Run `pnpm -w run automation:configure-vercel-env` with local `.env.vercel-production` file containing the `NEXT_PUBLIC_*` vars from [DEPLOYMENT.md](DEPLOYMENT.md). Needs `VERCEL_API_TOKEN` + `VERCEL_PROJECT_ID`.

### Stage 6 — smoke tests (manual, cannot automate)
11. Log in via magic-pin on the live site → land on `/workspace`
12. Kick off a toy Vibe Coder spec → confirm trace shows AppArchitect → AppGenerator → build check → AppDeployer running on the WORKER (check worker logs, not API logs)
13. Kill the worker mid-run via Render dashboard "Manual Deploy → Clear cache & deploy" → within ~60s a NEW worker boot reclaims the orphaned job (verify in Render worker logs)

### Stage 7 — OPTIONAL: observability via Grafana Cloud (defer until needed)

**Don't do this until you have real user load.** Render's built-in logs + service-down email alerts cover the critical failure modes pre-launch. When you have >50 paying users OR >500 workflows/day, enable this stack:

14. Uncomment the `jak-swarm-grafana-agent` block in `render.yaml`
15. Sign up for Grafana Cloud Free (https://grafana.com/products/cloud/). Create a stack.
16. In Grafana Cloud → Connections → Prometheus → "Send Metrics": copy the Remote Write URL, numeric user, and create an access-policy token with `metrics:write`.
17. Re-apply the blueprint → Render creates `jak-swarm-grafana-agent` pserv
18. Run `pnpm -w run automation:sync-env-to-render -- jak-swarm-grafana-agent` with these three values as `GRAFANA_CLOUD_PROM_URL` / `GRAFANA_CLOUD_PROM_USER` / `GRAFANA_CLOUD_PROM_API_KEY`.
19. Verify scraping: Grafana Cloud → Explore → run query `up{project="jak-swarm"}` — should return two rows (api=1, worker=1).
20. Import dashboard: Dashboards → New → Import → upload `ops/grafana/dashboards/jak-swarm.json`.
21. Import alerts: Alerting → Alert rules → New → Import → upload `ops/prometheus/alerts.yml`.
22. Wire Slack + email contact points.

---

## What this list is NOT

It is not a roadmap. It is not wishlist items ordered by hype. It is the list of actions that only you can take, because they require credentials, infra provisioning, brand decisions, or in-person QA.

Hand any item off when it's delegable. Own every item that isn't.
