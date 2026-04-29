# YC Application Pack

This doc consolidates the positioning, one-liner, demo script, design-partner outreach,
interview-prep answers, and metrics-pull instructions for the next YC batch application.
It is intentionally narrow — feature-soup language is removed in favor of the wedge.

Last updated: 2026-04-29.

---

## The wedge (do not deviate)

**Target user:** founder-led teams (1–10 people) who run their own marketing, research,
content, code review, and outreach without a full-time team.

**The job they hire JAK for:** safely delegate company work to AI — get the result back
fast, with human approval on every action that matters.

**What we are NOT pitching:** generic "AI OS for companies", multi-agent platform,
agent-to-agent protocol, audit/compliance as the lead story, or Vibe Coding.
Those surfaces stay in the product as depth. They are not the YC pitch.

---

## One-liner (use everywhere)

> **JAK is an AI workflow operator for founder-led teams. Give it a task in plain
> English — research, content, code review, outreach — and JAK plans the steps,
> runs the right specialists, asks your approval before anything risky, and gives
> you an audit trail.**

### 7-word problem statement

> AI agents still cannot safely execute company work.

### Solution one-liner

> JAK turns business tasks into approved, auditable AI workflows.

---

## YC application — short answers

### What does your company do?
JAK is an AI workflow operator for founder-led teams. We help solo founders and
small teams safely delegate company work to AI — research, content, outreach,
code review — by turning natural-language tasks into planned, approved,
auditable workflows.

### What is the problem you are solving?
AI agents today can chat and write, but they cannot safely *execute* company
work. Founders running multiple products by themselves want to delegate
"research my competitors and draft a LinkedIn post" or "review my landing page
and propose fixes" — but no agent platform makes the loop safe enough to actually
trust without watching every step. JAK closes that loop with a planning layer,
specialist agents, payload-bound human approvals, and a tamper-evident audit trail.

### Why now?
Two recent shifts. First, OpenAI's Responses API + structured outputs make
multi-step agent plans reliable enough to sell. Second, a wave of solo founders
running AI-first companies (us included) need to ship marketing / research /
content workflows that used to require an agency or a 5-person team. Existing
agent platforms either chat-only (ChatGPT, Claude) or are dev-only frameworks
(LangChain, LlamaIndex). Nothing sits in the middle for a founder who wants the
result, not the framework.

### Why us?
I (Reetu) am a solo founder running multiple products simultaneously
(InBharat.ai, SocialFlow, UniAssist, TestPrep, Sahayak, JAK) — every workflow
JAK automates is one I run myself every week. I built JAK because the existing
tools failed me, not because I scanned the market. The pain comes from my own
life. The platform is what I needed.

### What is your traction?
*(Fill in from `/metrics/yc-snapshot?days=7` — see below.)*
- N design partners using JAK weekly
- X workflow runs in the last 7 days
- Y approval events processed
- Z hours saved per partner per week (self-reported)

### What is your unfair edge?
1. **Approval card with payload binding.** Most agent platforms ship "approve
   once, replay forever." JAK rejects 409 if the proposed payload was
   tampered with between the approve click and the actual execution. This is
   the one thing enterprise customers will pay extra for.
2. **A founder's daily life as the dogfood.** I run six products solo. JAK
   eats my own work output every day. Bug reports come from me losing money.
3. **Open-source core (MIT).** Solo founders trust open-source. Self-hostable.
   Pro tier for hosted runtime + approvals + premium models.

### Why solo, can a co-founder commit?
*(Have a non-defensive answer ready. Reference YC precedents — Adora Cheung,
Drew Houston pre-Arash. Then state the plan to find a co-founder if invited.)*

---

## 60-second demo script

**Setup before you press record:**
- Pre-seeded demo tenant with company profile filled in (name, industry, brand
  voice, target customers).
- One Gmail integration pre-connected (or any other connector — pick one that
  shows external action).
- One pending approval already created from a prior run, so you can show the
  inline approval card without waiting for plan + execute time.
- Cockpit zoom level: 100%. No dev tools open. No stale notifications.

**Script (read aloud, ~60 seconds):**

> *(0:00)* "I'm a solo founder running six AI products. Every week I need to
> research competitors, write LinkedIn posts, review my landing pages, and
> draft outreach to design partners. I built JAK because no existing tool let
> me delegate this safely.
>
> *(0:10)* Watch. I type one task. *[paste: "Research my top 3 competitors and
> draft a LinkedIn post about how we are different."]*
>
> *(0:18)* JAK reads my company context — brand voice, target customers,
> products — that I set up once at onboarding. It plans the steps. *[show plan
> appearing in cockpit]*
>
> *(0:25)* Specialist agents run in parallel. Research, content, brand-voice
> alignment. *[show progress in cockpit]*
>
> *(0:35)* Before anything publishes, JAK pauses for my approval. *[click
> approval card]* Notice — the card shows the EXACT post that will go out, the
> account it'll post to, and a hash that binds my approval to this specific
> draft. If anyone tampers with the draft after I click approve, JAK rejects
> the action.
>
> *(0:48)* I approve. Post drafts saved to my drafts folder. Audit trail is
> tamper-evident — every step logged.
>
> *(0:55)* This is one of six template workflows. The same loop runs for
> outreach drafts, website reviews, code reviews, and competitor research.
> Every founder-led team I talk to wants this."

---

## Design-partner outreach DM

Use this template verbatim. Personalize line 1 only.

### Variant A — for fellow solo founders

> Hey [name] — I'm testing JAK, an AI workflow operator I built for solo
> founders like us. Instead of chatting with an LLM, you give it a task like
> "research my competitors and draft a LinkedIn post" or "review my website
> and suggest fixes" — it plans the work, runs the right specialists, asks
> your approval before anything publishes, and gives you an audit trail.
>
> I'm onboarding 3 design partners free for 2 weeks. I just need honest
> feedback and one weekly workflow from you. Open to a 20-min call?
> — Reetu

### Variant B — for founders with growing content/marketing pain

> Hey [name] — saw your post about [specific recent pain]. I'm building JAK,
> a workflow tool for founders who want to delegate marketing / research /
> outreach to AI without losing control. Different from ChatGPT — JAK plans
> the steps, runs specialist agents, and asks your approval before anything
> goes out.
>
> I'm picking 3 founder-led teams to use it free for 2 weeks. Interested?
> — Reetu

### Variant C — for technical founders interested in the architecture

> Hey [name] — I built JAK because I was drowning running 6 products solo
> and existing agent platforms either chatted (ChatGPT) or were too low-level
> (LangChain). JAK sits in between: natural-language task → planned workflow
> → specialist agents → payload-bound human approval → audit trail. MIT
> licensed core, self-hostable.
>
> Would value 20 min of your honest feedback. Free use for 2 weeks if you'd
> run one workflow per week.
> — Reetu

---

## Outreach targets (first wave)

Aim for 3 design partners by end of week 1. Targets to message FIRST:

1. Fellow founder-led-team operators (your network — InBharat / SocialFlow / etc.)
2. SaaS founders running marketing solo (Twitter, IndieHackers, Reddit r/SaaS)
3. Education / NGO consultants running their own content + outreach
4. Compliance-conscious B2B founders (the audit pack lands when conversation deepens)

Avoid in week 1: VCs, big companies, agencies, students, "I'm just curious" types.
Wait for traction signal first.

---

## Pulling YC numbers from the platform

Each Friday, screenshot these for the YC application:

```bash
# Tenant-level (a single design partner's usage)
curl -H "Authorization: Bearer $JAK_TENANT_ADMIN_TOKEN" \
  https://api.your-domain.com/metrics/yc-snapshot?days=7 | jq

# Platform-level (all design partners + retention proxy)
curl -H "Authorization: Bearer $JAK_SYSTEM_ADMIN_TOKEN" \
  https://api.your-domain.com/metrics/yc-snapshot?days=7 | jq
```

Numbers worth quoting in the application:

- `workflowRuns.completed` last 7 days — "X workflows finished end-to-end"
- `approvals.total` last 7 days — "Y approval events processed"
- `activeUsers` — "Z founders running JAK weekly"
- `retention.tenantsWith5PlusRunsThisWeek` — **most important** — proves
  retention beyond first-touch curiosity
- `topTemplates` — shows which job JAK is actually being hired for

---

## Pre-demo / pre-application checklist

Run through this 24 hours before submitting or recording the Loom.

- [ ] Rotate any leaked credentials (see `docs/SECURITY-NOTES.md`).
- [ ] Verify Gmail / Slack / GitHub integrations are LIVE-connected on the demo
      tenant. Re-OAuth if any token has expired.
- [ ] Run the chosen demo workflow ONE FULL TIME end-to-end the day of
      recording. Confirm the approval card surfaces tool/files/expected.
- [ ] Have a pre-recorded 90-second backup video in case the live demo fails.
- [ ] Hide cockpit zones a layman shouldn't see during the demo (Audit panel
      already gates to REVIEWER+ — confirm the demo user is END_USER).
- [ ] `pnpm test` green. `pnpm check:truth` exit 0. `pnpm -r typecheck` green.
- [ ] Landing page screenshot in dark mode (the brand mode) for the YC app.

---

## Common YC interview questions you must rehearse

Memorize cold-recall answers for these. If any feels off, rewrite it. Do not
improvise live.

1. "What does your company do?" → 7-word problem + one-liner. 12 seconds max.
2. "Who is using it this week?" → Names + workflows + retention week-2.
3. "What did you ship in the last 7 days?" → Concrete commits, not features.
4. "What did the last 5 user conversations tell you?" → 1-sentence per partner.
5. "Why solo? Can a co-founder commit?" → Non-defensive, precedented.
6. "Why now?" → Responses API + structured outputs + solo-founder wave.
7. "What is your unfair edge?" → 3 bullets: payload binding, dogfood, OSS core.
8. "What is your business model?" → $0 free OSS, $29 hosted, $99 team, $249
   enterprise. Lead with hosted runtime as the wedge.
9. "What if OpenAI / Anthropic ships this?" → They ship chat. We ship workflow
   loops with approvals + audit. Different category, different sale.
10. "What is the long-term vision?" → AI operating system for company work.
    Day-one wedge is founder-led teams; expansion is small-team enterprise.

---

## What to NOT say in the application

- "AI Operating System for companies." — too broad
- "Multi-agent platform." — feature soup
- "We have built X agents and Y connectors." — feature inventory
- "We are building infrastructure for the agent economy." — vague
- "We will integrate with [list of 30 things]." — distraction
- "Compliance pack" or "SOC 2 audit" as the LEAD story — that's enterprise
  expansion, not the wedge

If a sentence in your application uses any of the above, rewrite it.

---

## Honesty contract

Every claim in the YC application must be backed by something in the codebase
or the `/metrics/yc-snapshot` numbers. If a number isn't real yet, say "design
partner pilot" not "active users." If a feature isn't shipped, don't list it.
The bar YC pattern-matches against is "does this founder cut through their own
hype." Cut through yours.
