# JAK Swarm — Product Hunt Launch Package

> Generated: 2026-04-06

---

## 1. Product Hunt Listing

### Tagline (58 chars)
```
33 AI agents that run your company autonomously
```

### Description (258 chars)
```
JAK Swarm is an open-source multi-agent AI platform with 33 specialized agents, 74 tools, and 6 LLM providers. Give it a goal — it plans, executes, and verifies complex business workflows autonomously, with human-in-the-loop approval gates for high-risk actions.
```

### First Comment (Maker's Comment)

---

Hey Product Hunt! I'm the builder behind JAK Swarm, and I want to tell you the real story of why this exists.

**The problem I kept hitting:** Every "AI automation" tool I tried fell into one of two traps. Either it was a toy — great for demos, useless for anything that touched real business data — or it was a black box that would cheerfully send emails to the wrong people, overwrite CRM records, or make API calls without any human oversight. I needed something I could actually trust with my company's operations.

**So I built JAK Swarm.**

The core idea is a two-tier swarm: **Orchestrators** that think and plan, and **Workers** that act. The Commander receives your goal. The Planner decomposes it into a dependency graph. The Guardrail validates every action against your policies. Workers execute against real systems — email, calendar, CRM, documents, browser automation, research. The Verifier checks that the output actually achieved what you asked. Every step is traced.

**What makes it different from CrewAI / LangGraph / Devin:**

- **CrewAI/LangGraph** are frameworks for building agents — you still have to wire everything together, write the prompts, define the tools. JAK Swarm is a *platform*: 33 agents and 74 tools are already built, configured, and policy-governed. You bring the goal.
- **Devin** is a brilliant software engineer. JAK Swarm is a company operations platform. Different jobs — email routing, CRM updates, document workflows, customer support triage, scheduling, research synthesis.
- **The approval gate** is the thing I haven't seen done properly anywhere else. High-risk tasks pause and notify a human reviewer before executing. You can configure the threshold per tenant and per industry. Healthcare? Approval required at MEDIUM risk. Internal ops? Only CRITICAL. This is what makes it safe enough to actually run unsupervised.

**The tech stack** (for the engineers here): TypeScript monorepo, Next.js frontend, Hono API server, Temporal for durable workflow orchestration (crash-safe, replay-safe), PostgreSQL + Prisma, Redis, pgvector for RAG. The workflow execution graph is visualised in real-time in the UI via React Flow.

**What's working today:** The full agent swarm, tool registry (email, calendar, CRM, documents, spreadsheets, browser automation, research, knowledge base), multi-tenant isolation, approval workflows, voice interface (OpenAI Realtime API), industry packs for 13 verticals, and the 3-tier skill extension system.

**What's honestly not there yet:** Kubernetes deployment manifests (targeting Phase 2), the Prometheus metrics dashboard, and a few of the enterprise CRM adapters. I'd rather ship the real thing and be honest about the roadmap than overpromise.

GitHub: **github.com/inbharatai/jak-swarm**

Would love questions, feedback, and brutal honesty in the comments. This is v1 — let's build it together.

---

### 5 Screenshot Descriptions

**Screenshot 1 — Workflow DAG (Hero Shot)**
The trace viewer showing a live workflow execution graph built with React Flow. Nodes are the agents (Commander → Planner → Router → Worker Email / Worker CRM in parallel → Verifier → Commander). Each node shows status (running/completed/pending approval) with latency. This is the "wow moment" — you can watch your company run itself in real time.

**Screenshot 2 — Integrations Page**
A grid of all connected tools and providers: Gmail, Google Calendar, Google Docs, Google Sheets, Salesforce, HubSpot, Pipedrive, Slack, Playwright Browser, Tavily Research, Pinecone, pgvector — with enabled/disabled toggles per tenant. Showcases the breadth of the 74 tools.

**Screenshot 3 — Agent Activity Tracker**
The live agent run log: a scrolling timeline of agent steps, tool calls, handoffs, and results. Each row shows the agent role, action taken, duration, and a snippet of the result. Guardrail verdicts (ALLOW/WARN/BLOCK) appear inline. Makes the "black box" completely transparent.

**Screenshot 4 — Schedule & Automation Dashboard**
The scheduled workflows view: recurring jobs (e.g. "Weekly CRM cleanup — every Monday 8am", "Daily support ticket triage — 9am"), their last run status, next run time, and a history of pass/fail. This is the "set it and forget it" angle — JAK Swarm running your company while you sleep.

**Screenshot 5 — Approval Queue**
The human-in-the-loop approval UI. A pending approval card shows: the workflow that triggered it, the agent's proposed action, the risk level (HIGH), the data it wants to act on, and the rationale. Two buttons: Approve / Reject. This is the trust layer — the screenshot that answers "but what if it does something wrong?"

---

## 2. Launch Day Twitter Thread (10 Tweets)

---

**Tweet 1 — The Hook**
```
I built an open-source platform with 33 AI agents that runs your company autonomously.

Not a demo. Not a framework. A production-grade system with:
• 74 tools
• 6 LLM providers
• Human approval gates for high-risk actions
• Full execution trace

github.com/inbharatai/jak-swarm

🧵
```

**Tweet 2 — The Architecture**
```
Here's how it works:

Commander receives your goal.
Planner breaks it into a dependency graph.
Guardrail validates every action against your policies.
Router dispatches Workers in parallel.
Verifier confirms the output actually achieved the goal.

Every step is traced. Nothing is a black box.
```

**Tweet 3 — The Workers**
```
The 17 Worker agents cover the full stack of company operations:

📧 Email — read, draft, send, classify
📅 Calendar — schedule, invite, resolve conflicts
🗂 CRM — contacts, deals, notes (Salesforce / HubSpot / Pipedrive)
📄 Documents & Spreadsheets
🌐 Browser automation
🔍 Research & Knowledge base
🎤 Voice (OpenAI Realtime)
```

**Tweet 4 — The Approval Gate**
```
The feature I haven't seen anyone else do right:

Before any high-risk action executes, the workflow pauses and sends you an approval request.

You see exactly what the agent wants to do and why.
You approve or reject with one click.

Configurable threshold per tenant, per industry.
This is what makes autonomous AI safe to actually run.
```

**Tweet 5 — Industry Packs**
```
JAK Swarm ships with 13 industry packs:

Healthcare, Legal, Finance, Insurance, Recruiting, Retail, Logistics, Education, Hospitality, Manufacturing, Consulting, Customer Support, General.

Each pack customises agent prompts, tool permissions, compliance rules, and approval thresholds for that vertical.

No code changes. Just config.
```

**Tweet 6 — The Skill System**
```
The 3-tier skill system lets you extend what agents can do:

Tier 1: Built-in skills (pre-approved, compiled into the platform)
Tier 2: Auto-generated plan skills (Planner creates these at runtime)
Tier 3: Operator-proposed skills (TypeScript code, sandboxed, human-reviewed before activation)

Your agents grow with your business.
```

**Tweet 7 — The Voice Interface**
```
Yes, it has a voice interface.

Speak your goal → OpenAI Realtime API transcribes + understands intent → Commander launches the workflow → result is spoken back to you.

Fallback: Deepgram (STT) + ElevenLabs (TTS) if Realtime is unavailable.

Push-to-talk or hands-free VAD mode.
```

**Tweet 8 — The Tech Stack**
```
For the engineers:

• Next.js (web)
• Hono (API — port 4000)
• Temporal (durable workflow orchestration — crash-safe, replay-safe)
• PostgreSQL + Prisma + pgvector
• Redis (queues, sessions, rate limits)
• React Flow (live execution DAG)
• pnpm monorepo

Full docker-compose local setup. One command to run everything.
```

**Tweet 9 — The Comparison**
```
How JAK Swarm compares to alternatives:

vs CrewAI / LangGraph:
→ They're frameworks. You build the agents.
→ JAK Swarm is a platform. 33 agents are already built.

vs Devin:
→ Devin writes code. JAK Swarm runs operations.
→ Different jobs.

vs n8n / Zapier:
→ JAK Swarm reasons about your goal. It doesn't need pre-defined flows.
→ It adapts. It verifies. It handles failure.
```

**Tweet 10 — CTA**
```
JAK Swarm is fully open-source.

⭐ Star it: github.com/inbharatai/jak-swarm
📖 Read the architecture: github.com/inbharatai/jak-swarm/blob/main/docs/architecture.md
🗺 See all 33 agents: github.com/inbharatai/jak-swarm/blob/main/AGENTS.md

Would love your feedback, PRs, and hard questions.

What workflow would you automate first?
```

---

## 3. Hacker News "Show HN" Post

### Title (79 chars)
```
Show HN: JAK Swarm – open-source autonomous multi-agent platform (33 agents)
```

### Body

JAK Swarm is an open-source autonomous multi-agent AI platform I've been building to solve a specific frustration: existing agent frameworks require you to build everything yourself, while existing automation platforms can't reason or adapt. I wanted something that could take a natural-language goal and execute it reliably against real business systems.

**Architecture overview:**

The swarm is split into two tiers. Orchestrators (Commander, Planner, Router, Verifier, Guardrail, Approval Manager) decompose goals, enforce policies, and sequence execution — they never touch external systems directly. Workers (Email, Calendar, CRM, Document, Spreadsheet, Browser, Research, Knowledge, Support, Ops, Voice) execute concrete actions against real tools.

The execution backbone is **Temporal** for durable workflow orchestration. Every agent run is a Temporal Activity, which means crash recovery is free — if the worker process dies mid-execution, Temporal replays the workflow from the last completed activity. Tool calls carry idempotency keys to prevent double-execution on replay.

**The tech stack:**
- TypeScript monorepo (pnpm workspaces + Turborepo)
- Next.js frontend with React Flow for live execution DAG visualisation
- Hono API server
- PostgreSQL + Prisma ORM + pgvector for RAG
- Redis for job queues, sessions, and rate limiting
- OpenAI Agents SDK as the agent runner

**The piece I haven't seen elsewhere — the Guardrail + Approval gate:**

Every plan is validated by a Guardrail agent before execution. Every tool call result is checked post-execution. The Guardrail emits ALLOW / WARN / BLOCK verdicts. For high-risk tasks, the Router pauses execution and creates a human-readable ApprovalRequest that sits in a review queue until a human signs off. This is configurable per tenant and per industry pack. Without this, I wouldn't trust the system with anything that sends emails or writes to CRMs.

**Industry packs** are declarative config objects (not code) that customise agent behaviour for specific verticals — healthcare, legal, finance, recruiting, etc. They inject compliance rules into the Guardrail, constrain which tool categories are available, supplement agent prompts with domain context, and set default approval thresholds. Adding a new industry is purely a config change.

**What's working:** Full agent swarm, 74 tools across 10 categories, multi-tenant isolation (row-level in Postgres, namespace-level in Redis), voice interface via OpenAI Realtime API, 3-tier skill extension system with sandbox execution and human review, 13 industry packs.

**What's honestly not done yet:** Kubernetes manifests (Phase 2 target), Prometheus metrics integration, a few CRM adapters, and the public hosted version. This is v1 — I'm shipping the core, not vaporware.

GitHub: https://github.com/inbharatai/jak-swarm

Happy to go deep on any part of the architecture in the comments. Particularly interested in feedback on the Temporal integration, the Guardrail design, and whether the industry pack abstraction is the right level of configurability.

---

## 4. Reddit Posts

---

### r/artificial — Agent Architecture Deep Dive

**Title:** I built a 33-agent autonomous AI swarm with Guardrails, Temporal, and human-in-the-loop approval gates — open source

**Body:**

Been working on an open-source project called JAK Swarm that I think the AI/agent crowd here will find interesting — specifically the architectural decisions I made around safety and reliability.

**The core problem with autonomous agents:**
Most agent systems fail in production for one of two reasons: (1) they go off-script and take actions you didn't intend, or (2) they're so restricted they can't do anything useful. I wanted to find a middle path.

**The architecture I landed on:**

A two-tier swarm. Orchestrators (Commander, Planner, Router, Verifier, Guardrail, Approval Manager) reason and coordinate — they never call external tools. Workers (Email, Calendar, CRM, Documents, Browser, Research, Voice, etc.) act — they never make decisions about sequencing or policy. This separation enforces accountability: if a worker does something unexpected, the orchestration chain is traceable.

**The Guardrail agent** is stateless and wraps every plan (pre-execution) and every tool call result (post-execution). It evaluates against tenant policy overlays and industry-specific compliance rules. It emits ALLOW / WARN / BLOCK. BLOCK halts the workflow immediately and surfaces the violation to the user. This is different from just putting safety instructions in the system prompt — it's a separate evaluation pass that can't be bypassed by creative goal phrasing.

**The Approval Manager** creates a human review gate for high-risk actions. The workflow actually pauses — Temporal blocks the activity until the human resolves the request. The reviewer sees the proposed action, the data, and the rationale. No auto-approve, no workarounds.

**Multi-agent coordination** uses structured handoffs rather than direct function calls. Each handoff is logged. Circular handoff detection prevents infinite loops. Workers can't call other workers — all coordination routes through the Router.

Currently supports 6 LLM providers, 74 tools, 33 agents, 13 industry packs.

**GitHub:** https://github.com/inbharatai/jak-swarm

What approaches have others taken for the "safety vs capability" tradeoff in autonomous agent systems? Would love to discuss alternatives to the Guardrail design.

---

### r/SideProject — Builder Story

**Title:** I spent months building a 33-agent AI platform that runs business operations autonomously — launching today on Product Hunt

**Body:**

Hey r/SideProject — launching something today that I've been heads-down building for months.

**What it is:** JAK Swarm — an open-source platform with 33 AI agents that can autonomously handle business workflows: emails, calendar scheduling, CRM updates, document creation, web research, customer support triage, and more.

**Why I built it:** I kept hitting the same wall. I'd try to use AI to automate something at work, and it would either be a toy (great demo, breaks on anything real) or a black box I didn't trust. I wanted a system I could point at a goal like "follow up with all leads who haven't responded in 7 days, personalise each email with their last interaction, log the activity in the CRM" and have it just... work. Reliably. Without me babysitting it.

**The thing I'm most proud of:** The human-in-the-loop approval gate. Before any action that could cause real-world consequences — sending an email to a customer, updating a deal in Salesforce, submitting a form — the workflow pauses and asks me to approve. I can see exactly what it wants to do and why. This is what separates "interesting demo" from "I'll actually run this on my business."

**The honest bit:** It's v1. The core swarm works. There are rough edges. The Kubernetes deployment isn't done. Some enterprise CRM adapters are missing. But the architecture is solid and I'd rather ship and iterate than perfect in private.

If you're working on something similar or have feedback, I'm all ears. The solo builder journey is better with community.

**Product Hunt:** [launching today]
**GitHub:** https://github.com/inbharatai/jak-swarm

---

### r/webdev — Tech Stack Deep Dive

**Title:** Built a multi-agent AI platform with Next.js + Hono + Temporal + React Flow — here's the stack and what I learned

**Body:**

Just shipped an open-source project and wanted to share the tech stack decisions with r/webdev since I made some unconventional choices that might be interesting.

**Project:** JAK Swarm — an autonomous multi-agent AI platform. 33 agents, 74 tools. The frontend visualises the live workflow execution graph as it runs.

**The stack:**

**Frontend — Next.js App Router**
The main app is Next.js. The most interesting piece is the workflow trace viewer — a real-time DAG rendered with **React Flow**. Agent nodes update their status live via SSE. Each node is clickable and shows the full input/output/handoff details for that agent step. Getting React Flow to work well with dynamically-updating graph data was non-trivial (lots of memo and callback tuning to avoid re-render storms).

**API — Hono on Node.js**
Switched from Fastify to Hono mid-build. Hono's TypeScript ergonomics are excellent — the `c.var` pattern for middleware-injected context is clean, and the zod-openapi integration generates the Swagger docs automatically. Performance is great. One gotcha: the SSE implementation requires careful handling of the `AbortSignal` to avoid memory leaks on client disconnect.

**Orchestration — Temporal**
This was the biggest architectural bet and it paid off. Temporal gives you durable, replay-safe workflow execution for free. When an agent workflow spans multiple tool calls over minutes, and your worker process crashes halfway through, Temporal replays from the last completed activity. Idempotency keys on tool calls prevent double-execution on replay. The learning curve is real (the Temporal mental model takes a week to click) but it's the right foundation for anything that needs to be reliable.

**Database — PostgreSQL + Prisma + pgvector**
Standard Prisma setup. Added `pgvector` for the knowledge base RAG queries — semantic search over tenant documents without spinning up a separate vector DB. The multi-tenant isolation is all row-level (every table has `tenantId`, enforced at the repository layer).

**Redis**
Job queues (BullMQ), session storage, rate limiting. Redis keys are namespaced: `jak:{tenantId}:{resource}` to prevent cross-tenant bleed.

**What I'd do differently:** The monorepo package structure got complicated fast. I'd define the shared types package interface more carefully upfront — I had to refactor it twice as the agent contracts evolved.

Happy to go deep on any of these. Code is at https://github.com/inbharatai/jak-swarm

---

## 5. LinkedIn Announcement Post

---

Excited to share something I've been building for a while: **JAK Swarm** — an open-source autonomous multi-agent AI platform that runs your company's operations.

**The elevator pitch:** 33 specialised AI agents, 74 tools, 6 LLM providers. Give it a goal in plain English. It plans the work, executes it across your real systems, verifies the results, and reports back.

**What "running your company" actually means:**

The agents cover the full operational stack — email management, calendar scheduling, CRM updates, document creation, spreadsheet operations, web research, customer support triage, internal knowledge retrieval, and browser automation. These aren't demos. They connect to Gmail, Google Calendar, Salesforce, HubSpot, Google Docs, Slack, and more.

**The business value proposition is simple:** a swarm of 33 AI agents that handles the coordination, execution, and verification work that currently requires 33 separate hires — or 33 separate one-off automation scripts that break when something changes.

**Why this is different from other AI tools:**

Most AI tools require you to define every step in advance. JAK Swarm reasons about your goal and decomposes it dynamically. It handles dependencies, parallel execution, failure recovery, and cross-system consistency checks automatically.

More importantly: **it knows when to stop and ask.** High-risk actions — sending bulk emails, modifying financial records, external API calls — go through a human approval gate before executing. This is the piece that makes it trustworthy for real business use.

**Industry-aware out of the box:** Healthcare, Legal, Finance, Insurance, Recruiting, Retail, Logistics, and 6 more verticals. Each comes pre-configured with the right compliance rules, tool permissions, and approval thresholds for that industry.

**It's fully open-source.** Built for transparency, extensibility, and community.

GitHub: github.com/inbharatai/jak-swarm

I'd love to hear from operators, founders, and enterprise teams thinking about AI-native operations. What workflow would you automate first?

#AI #Automation #OpenSource #MultiAgent #OperationsAI #EnterpriseAI #AIAgents

---

## 6. Newsletter Pitch Email

### Subject Line
```
Open-source AI platform that actually runs company operations (33 agents, not a framework)
```

### Email Body

Hi [Newsletter Name] team,

I wanted to pitch a story that I think fits your audience well.

**What I built:** JAK Swarm — an open-source autonomous multi-agent AI platform with 33 specialised agents, 74 tools, and 6 LLM providers. It's designed to run real business operations (email, CRM, documents, scheduling, research, customer support) without requiring users to build or configure agents themselves.

**Why it's different from what's already been covered:**

Most multi-agent coverage has focused on *frameworks* — CrewAI, LangGraph, AutoGen. These are excellent tools for developers who want to build their own agents. JAK Swarm is a different category: a production-ready *platform* where the agents are already built, the tools are already integrated, and the safety layer (a Guardrail agent + human approval gates) is baked in.

The key innovation is the trust model. Before any consequential action — sending an email, updating a CRM record, submitting a form — the platform creates a human-readable approval request and pauses until a person signs off. This is configurable per business type and per industry. It's what makes "autonomous AI" safe enough to actually run unsupervised on production data.

**The numbers that might interest your readers:**
- 33 agents across two tiers (orchestrators + workers)
- 74 tools spanning email, calendar, CRM, documents, spreadsheets, browser automation, research, and voice
- 13 industry packs (healthcare, legal, finance, recruiting, and more) with pre-configured compliance rules
- Built on Temporal for durable, crash-safe workflow execution

**Links:**
- GitHub: https://github.com/inbharatai/jak-swarm
- Architecture docs: https://github.com/inbharatai/jak-swarm/blob/main/docs/architecture.md
- Agent reference: https://github.com/inbharatai/jak-swarm/blob/main/AGENTS.md

Available for a demo, technical deep-dive, or Q&A. Happy to provide screenshots, screen recording, or a live walkthrough.

Thank you for considering it.

[Your name]
Builder, JAK Swarm

---

**Target newsletters:** The Rundown AI, Ben's Bites, TLDR AI, The Batch (DeepLearning.AI), Import AI, Ahead of the Curve, The Algorithm, Exponential View, ChinAI, AI Snake Oil

---

## 7. Influencer Outreach DMs

---

### DM 1 — Swyx / swyx.io (AI Engineer, Latent Space Podcast)

**Platform:** Twitter/X or LinkedIn

Hi Swyx — longtime listener of Latent Space. Your episode on agent frameworks and the "AI Engineer" role framing shaped a lot of how I thought about what I was building.

I just open-sourced JAK Swarm — a 33-agent autonomous platform for business operations. The angle that might interest you specifically: it uses Temporal for durable workflow orchestration, which I think is the underappreciated answer to "how do you make multi-agent systems reliable in production." Every agent run is a Temporal Activity. Crash recovery, replay-safety, and idempotency are free.

I've also been thinking hard about the Guardrail design — a stateless policy agent that intercepts every plan before execution and every tool result after. Would love your take on whether this is the right abstraction or if there's a better approach.

GitHub: github.com/inbharatai/jak-swarm. No ask — just thought it might be genuinely interesting to you.

---

### DM 2 — Yohei Nakajima (BabyAGI creator, agent pioneer)

**Platform:** Twitter/X

Hi Yohei — BabyAGI was the thing that convinced me multi-agent systems could actually work. I've been building on that intuition.

JAK Swarm is an open-source platform that takes the "task-driven autonomous agent" concept and operationalises it for business workflows — email, CRM, documents, scheduling, voice. 33 agents, 74 tools, built on Temporal for durability.

The piece I think you'd find interesting: the Verifier agent. After all tasks complete, it re-evaluates the combined output against the original goal, checks cross-task consistency (did the CRM update match the email that was sent?), and can trigger a remediation cycle if there are gaps. It's an attempt to solve the "agent hallucination compounds across steps" problem.

Would love any feedback: github.com/inbharatai/jak-swarm

---

### DM 3 — Simon Willison (Datasette, LLM CLI, prolific AI OSS commentator)

**Platform:** Twitter/X

Hi Simon — I read your blog obsessively. Your writing on the practical risks of autonomous AI systems influenced a lot of my safety design decisions.

I just shipped JAK Swarm — an open-source multi-agent platform for business operations. Given your focus on AI safety and transparency in OSS tools, I thought the architecture might be worth your eyes.

The core safety mechanism: a Guardrail agent that intercepts every plan and every tool call result, evaluating against tenant policy overlays. BLOCK verdicts halt the workflow immediately. High-risk actions go through a human approval gate backed by Temporal (so the workflow actually pauses — it's not just a flag). All agent traces are immutable and persisted for audit.

I've tried to design this so that "autonomous" doesn't mean "unsupervised for things that matter." Would value your perspective on where this falls short.

GitHub: github.com/inbharatai/jak-swarm

---

### DM 4 — Lior Ben David / @liorbendavid (AI tools reviewer, large Twitter following)

**Platform:** Twitter/X

Hi Lior — you cover a lot of the AI tools space and I think JAK Swarm is genuinely different from what you've reviewed before.

Most "AI automation" tools you see are either no-code workflow builders (n8n, Zapier with AI) or single-agent copilots. JAK Swarm is a 33-agent swarm that reasons about your goal, decomposes it into a dependency graph, and executes across real business systems — email, CRM, documents, calendar, web browser, voice.

The demo that gets the strongest reaction: you describe a goal in plain English ("Follow up with all leads who went cold in Q1, personalise each message based on their CRM history, log every interaction"), and you watch the execution DAG light up in real-time as agents work in parallel. The approval gate pauses it before any email is sent so you can review.

Happy to set up a demo call or provide a screen recording if that's easier than diving into the repo. GitHub: github.com/inbharatai/jak-swarm

---

### DM 5 — Greg Kamradt (LangChain educator, Chunking / RAG content)

**Platform:** Twitter/X or LinkedIn

Hi Greg — your LangChain tutorials and chunking research have been genuinely useful. JAK Swarm uses pgvector + semantic search for the knowledge base component, and your work on chunk sizing informed those design choices.

I just launched JAK Swarm on Product Hunt — an open-source multi-agent platform with a built-in Knowledge Worker agent that does RAG over tenant documents. The approach: pgvector in Postgres (no separate vector DB), semantic + full-text hybrid search, source citations on every answer, access-level tags (CONFIDENTIAL docs don't surface to END_USER roles).

The broader platform is 33 agents, 74 tools, Temporal for orchestration. Would love your take on the RAG implementation specifically — I suspect there are better chunking approaches for the mixed document types (contracts, support tickets, policies) that the knowledge base ingests.

GitHub: github.com/inbharatai/jak-swarm

---

*End of launch package — all assets are ready to copy.*
