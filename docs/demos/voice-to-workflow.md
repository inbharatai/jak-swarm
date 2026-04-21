# Voice → Workflow Demo

End-to-end walkthrough of the voice-trigger path: speak an intent in the browser, JAK creates a workflow, agents execute, and the trace streams back live.

This is the "how to record it / how to show it" doc. For architecture details, see [`apps/api/src/routes/voice.routes.ts`](../../apps/api/src/routes/voice.routes.ts) and [`apps/web/src/hooks/use-voice.ts`](../../apps/web/src/hooks/use-voice.ts).

---

## Prerequisites

One-time per deployment:

1. **`OPENAI_API_KEY`** with Realtime API access (`gpt-4o-realtime-preview` or newer).
2. **Redis** reachable from the API (`REDIS_URL`). Voice session metadata is stored there with a 1-hour TTL.
3. **Supabase** row in `users` with a tenant assigned — a fresh browser session will not create one on demand.
4. **(Optional) TURN relay** — set all three:
   - `VOICE_TURN_URL=turn:relay.example.com:3478?transport=udp`
   - `VOICE_TURN_USERNAME=…`
   - `VOICE_TURN_CREDENTIAL=…`
   Without these, voice falls back to STUN-only via `stun:stun.l.google.com:19302`. STUN alone is enough for residential networks but fails behind symmetric NAT / strict corporate firewalls.

If `OPENAI_API_KEY` is missing, the token-exchange endpoint returns **503 `VOICE_NOT_CONFIGURED`** instead of a synthesized mock. The frontend surfaces this as a clear "voice is not configured on this instance" banner — it never opens a dead WebRTC session.

---

## The 5-step demo flow

### 1. User starts a session

Click the microphone button in the dashboard. The browser hits:

```http
POST /voice/sessions
Authorization: Bearer <supabase-jwt>
Content-Type: application/json

{ "language": "en", "voice": "alloy" }
```

Response:

```json
{
  "success": true,
  "data": {
    "sessionId": "vs_1776760144822_abc123",
    "webRtcConfig": {
      "model": "gpt-4o-realtime-preview",
      "voice": "alloy",
      "iceServers": [
        { "urls": "stun:stun.l.google.com:19302" },
        { "urls": "turn:relay.example.com:3478", "username": "…", "credential": "…" }
      ],
      "realtimeEndpoint": "https://api.openai.com/v1/realtime",
      "ephemeralTokenEndpoint": "/voice/sessions/vs_…/token"
    },
    "expiresInSeconds": 3600
  }
}
```

### 2. Browser fetches an ephemeral token

```http
GET /voice/sessions/vs_1776760144822_abc123/token
```

The API calls OpenAI Realtime Sessions with its server-side key, returns a short-lived client token (~60s TTL). The raw `OPENAI_API_KEY` is never sent to the browser.

**Failure surfacing:**

| Cause | API status | Client-visible message |
|---|---|---|
| `OPENAI_API_KEY` unset | 503 `VOICE_NOT_CONFIGURED` | "Voice is not configured on this instance" |
| OpenAI 429 | 502 `VOICE_TOKEN_ERROR` | "Voice provider is rate-limited — try again in a moment" |
| OpenAI 5xx | 502 `VOICE_TOKEN_ERROR` | "Voice provider is temporarily unavailable" |
| Session expired | 404 `NOT_FOUND` | "Voice session expired — start a new one" |
| Cross-tenant access | 403 `FORBIDDEN` | "Access denied to voice session" |

### 3. Browser connects to OpenAI Realtime

The client opens a WebRTC peer connection using the `iceServers` + ephemeral token, and streams the user's microphone to OpenAI's realtime endpoint. OpenAI returns a live transcript stream.

### 4. User confirms the workflow

When the user finishes speaking, the dashboard shows the final transcript in a preview panel with two buttons: **Start Workflow** and **Discard**. No workflow is launched silently — the human stays in the loop.

Clicking **Start Workflow** hits:

```http
POST /voice/sessions/vs_1776760144822_abc123/trigger-workflow
Content-Type: application/json

{
  "transcript": "Research our top 3 competitors and draft a summary email to the team by 5pm",
  "goal": "Research top 3 competitors and draft summary email"
}
```

### 5. Workflow executes, trace streams live

The API creates a `Workflow` row, enqueues it on the swarm queue (`fastify.swarm.executeAsync`), and returns the workflow ID. The dashboard switches to the trace view and streams node-level events via SSE:

```
workflow:started  SwarmRunner
node:entered      Commander
node:completed    Commander
node:entered     Planner
…
```

High-risk actions (send-email, make-payment) pause at `AWAITING_APPROVAL` until the user clicks **Approve** in the approvals panel — the Phase 1 blocking-by-default behavior documented in [SECURITY-NOTES.md](../SECURITY-NOTES.md#5-approval-gate-auto-bypass).

---

## Running the demo locally

```bash
# 1. Start Postgres + Redis (docker-compose in the repo root).
docker compose up -d postgres redis

# 2. Boot the API with a real OPENAI_API_KEY.
export OPENAI_API_KEY=sk-…
pnpm --filter api dev

# 3. Boot the web app in a second terminal.
pnpm --filter web dev

# 4. Open http://localhost:3000, log in, click the mic icon.
```

If you see "Voice is not configured" — your `OPENAI_API_KEY` is not set in the API process (step 2). Check `curl -i http://localhost:4000/voice/sessions/foo/token`; you should see 503 `VOICE_NOT_CONFIGURED`.

---

## Recording the demo

Suggested scene order for a 60-second walkthrough:

1. (0:00) Dashboard empty state, mic icon idle.
2. (0:05) User clicks mic, speaks: *"Draft a cold email to the 5 SaaS companies we found yesterday, using our new value prop."*
3. (0:15) Transcript appears live, highlighted token-by-token.
4. (0:20) User clicks **Start Workflow**.
5. (0:22) Graph view opens, Commander → Planner → Router → Worker_Email nodes light up in sequence.
6. (0:35) Approval panel pops with draft email preview.
7. (0:45) User clicks **Approve**. Workflow completes. 5 emails drafted and queued for send.
8. (0:55) Trace timeline visible with cost + latency per node.

Text overlay suggestions: *"No silent launches. Human approval on every high-risk action. Every step traced."*

---

## Failure scenarios to demo (for trust-building)

- Unplug internet mid-session → graceful reconnect, transcript picks up where it left off.
- Kill the API process → workflow stays at `AWAITING_APPROVAL`, re-boot the API, decision resumes cleanly (Phase 1 durability).
- Exceed per-tenant rate limit → API returns 429, UI shows "Too many voice sessions in the last minute".
- Provide a deliberately malformed transcript → workflow fails gracefully with a typed error, trace shows the failure node.

---

## Known limits (as of 2026-04-21)

- **Transcript finalization** is opportunistic — we accept OpenAI's VAD-driven segmentation. A user who speaks in very long bursts with no pauses may see late finalization. Tunable via `turn_detection.silence_duration_ms` in [`voice.routes.ts`](../../apps/api/src/routes/voice.routes.ts).
- **No per-utterance cost tracking yet** — voice cost rolls up into the workflow's `totalCostUsd` but isn't broken out by minute. Planned for a future phase.
- **Multi-language handoff** — the voice session is locked to one language at session start. Switching requires a new session. OpenAI Realtime supports mid-session language switching but the UI doesn't expose it.
