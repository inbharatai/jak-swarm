# JAK Swarm — Project Memory

## Platform Stats (verified April 6, 2026 — LATEST)
- **Agents:** 33 (6 orchestrators + 27 workers)
- **Tools:** 104 (79 core + 25 C-suite execution tools)
- **Agent Actions:** ~114 total across all agents
- **Pages:** 15 UI pages
- **LLM Providers:** 6 (OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, Ollama)
- **Integration Connectors:** 8 (Gmail, Calendar, Slack, GitHub, Notion, HubSpot, Drive, Phoring)
- **MCP Providers:** 3 (Slack, GitHub, Notion)
- **Browser Tools:** 22 Playwright tools
- **Build:** 11/11 packages
- **Tests:** 56/56 unit + 40/40 human simulator (100%)
- **Human Simulator:** 40/40 (100%) with 5 test agents (Sarah CEO, Dev Engineer, Maya Marketing, Alex Ops, BrowserBot)
- **README:** 953 lines with 7 screenshots
- **Git Commits:** 14 on main branch
- **GitHub:** github.com/inbharatai/jak-swarm (public)
- **GitHub:** github.com/inbharatai/jak-swarm (public)

## Key Architecture Decisions
- LangGraph-style DAG execution (not linear chain)
- 4-layer anti-hallucination: prompt rules → reflectAndCorrect → verifier → auto-repair
- Gmail/Calendar via IMAP/SMTP + CalDAV (app passwords, no OAuth)
- MCP gateway for Slack/GitHub/Notion (official MCP servers)
- Persistent memory: DB-backed with in-memory fallback
- Cost controls: per-workflow budget, auto-approve low-risk tasks
- Error recovery: listener cleanup, state store TTL, concurrency limit (20), node timeout (120s)

## Social Media Auto-Posting
- DALL-E image generation tool (generate_image)
- post_to_twitter, post_to_linkedin, post_to_reddit tools
- discover_posting_platforms tool
- 5 pre-built scheduled workflows in scripts/seed-community-schedules.js
- Twitter login saved in Playwright persistent profile (~/.jak-swarm/browser-profile)
- LinkedIn and Reddit need login sessions saved

## Pricing
- Free: $0, 5 workflows/day, 1 user, basic agents
- Pro: $49/mo, unlimited workflows, 5 team members, all 33 agents, all integrations
- Enterprise: Custom, unlimited team, SSO/SAML, dedicated support

## Domain
- jaks.ai: TAKEN
- jakswarm.com: Available $11.25/yr (recommended)
- jakswarm.ai: Available $160/2yr

## User's Other Products
- Phoring.ai (C:\Users\reetu\Desktop\Phoring.ai) — Decision intelligence/forecasting platform
- Agent Arcade Gateway (C:\Users\reetu\Desktop\agent-arcade-gateway) — Agent control dashboard
- SahaayakSeva (C:\Users\reetu\Desktop\SahaayakSeva) — Personal assistant with Gmail/Calendar

## Key Decisions Made
1. Phoring.ai stays as external API — JAK connects via 4 phoring_* tools
2. Agent Arcade features built NATIVELY (not as SDK dependency) — no pixel art
3. Voice system is scaffolding — needs 3 pieces to work end-to-end
4. Coder agent cannot replace Claude Code — different scope
5. Browser auto-posting works for Twitter, needs API for LinkedIn/Reddit at scale
6. Supabase auth configured (optional, needs NEXT_PUBLIC_SUPABASE_URL)

## What Needs Doing Next
1. Deploy to Vercel
2. Buy domain (jakswarm.com recommended)
3. Set up Supabase project for auth
4. Get first 5 users
5. Post on HN "Show HN", Product Hunt, IndieHackers
6. Set up Twitter API ($100/mo) for reliable auto-posting
