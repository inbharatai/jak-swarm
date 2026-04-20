# JAK Swarm — Founder Action List

Ordered by risk first, then by blocking impact, then by effort. Each section names what the owner has to do — nobody else can.

Last reviewed: 2026-04-19.

---

## A. SECURITY (urgent — do now)

### A1. Rotate the Supabase service token
A Supabase service token was pasted in a Claude chat on 2026-04-18. It remains in the session transcript regardless of whether JAK ever wired Supabase. Rotate it in the Supabase dashboard. No code-side action is needed; if a future Supabase integration lands, it reads from env.

**How**: Supabase Dashboard → Project Settings → API → "Regenerate service_role key". Invalidate any place that token was stored.

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

## What this list is NOT

It is not a roadmap. It is not wishlist items ordered by hype. It is the list of actions that only you can take, because they require credentials, infra provisioning, brand decisions, or in-person QA.

Hand any item off when it's delegable. Own every item that isn't.
