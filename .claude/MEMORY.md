# JAK Swarm — Project Memory

## Platform Stats (verified April 10, 2026 — LATEST)
- **Agents:** 38 (6 orchestrators + 27 workers + 5 vibe coding)
- **Tools:** 108 built-in (excluding Phoring — not yet connected)
- **Pages:** 22 UI pages
- **LLM Providers:** 6 (OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, Ollama)
- **MCP Providers:** 20 (HubSpot, Salesforce, Pipedrive, Zoho CRM, Freshsales, Jira, Linear, Asana, ClickUp, Slack, Discord, Twilio, SendGrid, Supabase, Airtable, Google Drive, Stripe, Google Analytics, GitHub, Notion)
- **Browser Tools:** 20 Playwright + 7 sandbox
- **DB Models:** 22 Prisma models
- **Skills Marketplace:** 16 verified skills
- **CI/CD:** GitHub Actions (green), Dockerfile
- **GitHub:** github.com/inbharatai/jak-swarm (public, MIT)

## Pricing Tiers
- **Free:** $0, 3 workflows/day, 1 project, core agents, BYO API keys
- **Builder:** $29/mo, unlimited workflows, 5 projects, all agents, all integrations
- **Pro:** $99/mo, managed LLM keys, priority routing, GitHub sync, custom skills, voice
- **Team:** $249/mo, 5 seats, shared workspace, admin, RBAC, audit logs, SSO

## Architecture
- DAG execution with parallel scheduling + auto-repair
- 3-tier LLM routing (cost → balanced → premium)
- Circuit breaker for LLM calls
- DB-backed state persistence
- Multi-tenant: row-level isolation, per-tenant MCP + tool registry
- AES-256-GCM credential encryption
- Fetch-based SSE (secure, no token in URL)
- Supabase Auth + PostgreSQL (managed)
- Real CRM adapter (Prisma-backed, NOT mock)

## Phoring.ai
- NOT yet connected — user will share link to plan integration
- 4 tool stubs exist (forecast, graph_query, validate, simulate)

## Key Decisions
- BYO API keys on Free/Builder tiers (zero LLM cost for us)
- Managed keys on Pro tier (buy wholesale, mark up 30-40%)
- Deploy: Vercel (frontend) + Railway/Render (API) + managed Supabase
- No self-hosted infra until revenue > $5K/mo

## Mock Tools Status
- CRM: NOW REAL (Prisma-backed prisma-crm.adapter.ts)
- Email: Real (Gmail IMAP/SMTP)
- Calendar: Real (CalDAV)
- Browser: Real (Playwright)
- Document tools: LLM-passthrough (functional but delegate to AI)
- All tools are live — user requirement: NO mock tools
