# JAK Swarm — Environment Setup & Troubleshooting

Complete reference for environment variables, integration setup, and common issues.

---

## Environment Variables

| Variable | Required | Default | Description |
|:---------|:--------:|:-------:|:------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis for scheduling/queues |
| `AUTH_SECRET` | Yes | — | Random secret for session signing (32+ chars) |
| `AUTH_URL` | No | `http://localhost:3000` | Base URL for auth callbacks |
| `EVIDENCE_SIGNING_SECRET` | Yes (for audit pack) | — | 32+ byte random secret for HMAC-SHA256 signing of audit evidence bundles. Generate with `openssl rand -base64 48`. Without it the final audit pack route returns `503 BUNDLE_SIGNING_UNAVAILABLE`. Intentionally separate from `AUTH_SECRET` so the two can be rotated independently. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes (for storage) | — | Supabase project URL — required by `ArtifactService` for storing workpaper PDF / final-pack bytes |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (for storage) | — | Supabase service-role key — used by `ArtifactService` to upload to the `tenant-artifacts` bucket |
| `OPENAI_API_KEY` | Yes (one of OpenAI or Gemini) | — | OpenAI API key for GPT-5.5/5.4 execution |
| `GEMINI_API_KEY` | Yes (one of OpenAI or Gemini) | — | Google Gemini API key for 2.5 Pro/Flash/Flash-Lite execution |
| `LLM_PROVIDER` | No | `openai` | Default LLM provider: `openai` or `gemini`. Per-tenant preference overrides this at runtime. Gemini is the primary path for the Google AI Agents Challenge; OpenAI is the alternate supported path. |
| `JAK_SHIELD_MCP_URL` | No | — | JAK Shield MCP gateway URL. When set, routes high-risk actions through the 10-stage security pipeline. Defaults to local-only policy enforcement if unset. |
| `JAK_SHIELD_MCP_ENABLED` | No | `0` | Set to `1` to enable JAK Shield MCP integration for signed security decisions. Defaults to `0` (local policy enforcement only). |
| `JAK_SHIELD_MCP_API_KEY` | No | — | API key for JAK Shield MCP gateway (required if `JAK_SHIELD_MCP_ENABLED=1`). |
| `OPENAI_ORG_ID` | No | — | OpenAI organization ID |
| `JAK_FIELD_ENCRYPTION_KEY` | No | — | 64-hex-character AES-256-GCM field encryption key (32 bytes / 256 bits). Without it, workflow fields are stored cleartext (development default). |
| `JAK_DEV_AUTH_BYPASS` | No | — | Set to `1` to bypass auth in development |
| `GMAIL_EMAIL` | No | — | Gmail address for real email adapter |
| `GMAIL_APP_PASSWORD` | No | — | Gmail app password (not your account password) |
| `CALDAV_URL` | No | — | CalDAV server URL for calendar |
| `CALDAV_USERNAME` | No | — | CalDAV username |
| `CALDAV_PASSWORD` | No | — | CalDAV password |
| `OPENAI_REALTIME_MODEL` | No | `gpt-4o-realtime-preview` | Model for voice agent |
| `DEEPGRAM_API_KEY` | No | — | Deepgram STT adapter |
| `ELEVENLABS_API_KEY` | No | — | ElevenLabs TTS adapter |
| `ELEVENLABS_VOICE_ID` | No | — | ElevenLabs voice ID |
| `SLACK_SIGNING_SECRET` | No | — | Slack app signing secret for webhook verification |
| `SLACK_CLIENT_ID` | No | — | Slack OAuth client ID |
| `SLACK_CLIENT_SECRET` | No | — | Slack OAuth client secret |
| `TEMPORAL_ADDRESS` | No | `localhost:7233` | Temporal server (infrastructure-ready, API execution path not yet wired) |
| `TEMPORAL_NAMESPACE` | No | `jak-swarm` | Temporal namespace |
| `TEMPORAL_TASK_QUEUE` | No | `jak-main` | Temporal task queue |
| `NODE_ENV` | No | `development` | Environment |
| `API_PORT` | No | `4000` | API server port |
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:4000` | API URL for frontend |
| `NEXT_PUBLIC_APP_URL` | No | `http://localhost:3000` | App URL |
| `LOG_LEVEL` | No | `info` | Logging level |
| `DEFAULT_APPROVAL_REQUIRED` | No | `true` | Require human approval by default |

---

## Integration Setup

### 📧 Gmail (IMAP/SMTP)

1. Enable 2-Factor Authentication on your Google account
2. Go to [Google App Passwords](https://myaccount.google.com/apppasswords)
3. Generate an app password for "Mail"
4. Add to `.env`:

```bash
GMAIL_EMAIL="you@gmail.com"
GMAIL_APP_PASSWORD="abcd efgh ijkl mnop"
```

The system auto-detects these variables and switches from mock to real adapters.

### 💬 Slack (MCP)

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Add Bot Token Scopes: `channels:read`, `chat:write`, `search:read`, `users:read`
3. Install to workspace and copy the Bot User OAuth Token
4. In the dashboard: **Settings > Integrations > Slack** — paste token and Team ID

### 🐙 GitHub (MCP)

1. Generate a Personal Access Token at [github.com/settings/tokens](https://github.com/settings/tokens)
2. Select scopes: `repo`, `read:org`, `read:user`
3. In the dashboard: **Settings > Integrations > GitHub** — paste token

### 📝 Notion (MCP)

1. Create an integration at [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Copy the Internal Integration Secret
3. Share your Notion pages/databases with the integration
4. In the dashboard: **Settings > Integrations > Notion** — paste secret

---

## Docker Setup

For local development with Docker:

```bash
# Start PostgreSQL (pgvector) + Redis
docker compose -f docker/docker-compose.yml up -d
```

For production topology:

```bash
# Two-service topology: API (HTTP + SSE + enqueue) separate from queue worker (claim + run + reclaim)
docker compose -f docker-compose.prod.yml up -d
```

- PostgreSQL: pgvector on port 5433 (avoids conflicts)
- Redis: port 6380 (avoids conflicts)

---

## Troubleshooting

| Problem | Cause | Solution |
|:--------|:------|:---------|
| `Playwright times out` | Chromium not installed | `cd packages/tools && npx playwright install chromium` |
| `Email agent says "not connected"` | No Gmail credentials | Set `GMAIL_EMAIL` + `GMAIL_APP_PASSWORD` in `.env` |
| `Workflow stuck in RUNNING` | Server crashed mid-execution | Restart API — `recoverStaleWorkflows` runs on startup |
| `Budget exceeded` | `maxCostUsd` too low | Increase budget or remove limit |
| `MCP connection failed` | Wrong token/API key | Verify credentials in integration settings |
| `Database connection error` | PostgreSQL not running | Start PostgreSQL: `docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres` |
| `Module not found` | Stale build | Run `pnpm turbo build --force` |
| `Tool validation error` | Wrong input format | Check tool's `inputSchema` in source code |
| `SSE stream disconnects` | Proxy buffering | Set `X-Accel-Buffering: no` on your reverse proxy |
| `JWT expired` | Token older than 7 days | Re-authenticate via `POST /auth/login` |
| `429 TRIAL_DAILY_CAP_HIT` | Trial daily cap reached | Wait for UTC midnight reset, or upgrade to paid plan |
| `503 BUNDLE_SIGNING_UNAVAILABLE` | Missing signing secret | Set `EVIDENCE_SIGNING_SECRET` in `.env` |
| `503 AUDIT_SCHEMA_UNAVAILABLE` | Migration not applied | Run `pnpm db:migrate:deploy` to apply migration 15 |

---

## Performance Reference

| Operation | Time | Cost (OpenAI) | Cost (Gemini) |
|:----------|:----:|:-------------:|:-------------:|
| Simple research task | 10-30s | $0.01-0.05 | $0.01-0.03 |
| Multi-agent workflow (5 tasks) | 30-90s | $0.05-0.20 | $0.03-0.15 |
| Complex pipeline (10+ tasks) | 2-10min | $0.20-1.00 | $0.10-0.80 |
| Strategy-tier workflow (CEO/CFO/CMO) | 5-20min | $0.30-2.00 | $0.20-1.50 |
| Vibe Coding (full app) | 3-8min | $0.50-2.00 | $0.30-1.50 |
| Voice session (per minute) | Real-time | ~$0.06 | ~$0.04 |

### Resource Limits

| Resource | Default | Configurable |
|:---------|:-------:|:----------:|
| Max concurrent workflows | 20 | Yes |
| Max concurrent tasks per workflow | 5 | `MAX_CONCURRENT_TASKS` |
| Max tool iterations per agent | 10 | `maxIterations` |
| Per-node timeout | 122s | `NODE_TIMEOUT_MS` |
| Max replan attempts | 1 | `MAX_REPLAN_ATTEMPTS` |
| State store TTL | 5 min | Hardcoded |
| Workflow timeout (default) | 20 min | `defaultTimeoutMs` |
| SSE heartbeat interval | 15s | Hardcoded |
| Voice session TTL | 1 hour | `VOICE_SESSION_TTL_SECONDS` |
| Auth rate limit | 10 req/min/IP | `AUTH_RATE_LIMIT` |
| Pagination max per page | 100 | Query param `limit` |