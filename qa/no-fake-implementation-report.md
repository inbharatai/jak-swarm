# JAK Swarm — Fake / mock / placeholder implementation catalog

**Commit:** `df5ec62`
**Method:** Repo-wide regex scan via subagent, classified by risk tier A/B/C/D.
**Exclusions:** `node_modules`, `dist`, `.next`, `.git`, `tests/`, `qa/`, `.claude/`, docs.

## Classification

- **A — Acceptable test/dev code** (fixtures, intentional fallbacks behind clear labels)
- **B — Acceptable production code** (documented failsafes, "not configured → throw" stubs)
- **C — Dangerous fake production** (returns success while doing nothing real)
- **D — UI claims not backed by backend** (button wired to stub, "Active" badge on dead feature)

## Top-10 dangerous findings (C + D) — need to fix

These are the items that could actively mislead users or LLMs into thinking something worked when it didn't.

### C1. MockCalendarAdapter embeds `_mock: true` in success response

**File:** `packages/tools/src/adapters/calendar/mock-calendar.adapter.ts:151-175`
**Pattern:** `createEvent()` returns `{ ...event, _mock: true, _notice: 'Calendar not connected...' }`
**Risk:** LLM caller sees `{id, title, startTime, ...}` — looks like a successful event. Must inspect `_mock` flag specifically. User in UI sees event in the success bubble, but it's only in memory.
**Fix:** Replace mock adapter with one that throws `NotConfiguredError` with a human-readable message telling the LLM to ask the user to connect Google Calendar first.

### C2. MockEmailAdapter.sendDraft() returns `{ success: false }` cast as `Promise<void>`

**File:** `packages/tools/src/adapters/email/mock-email.adapter.ts:278-296`
**Pattern:** `return ({ success: false, _mock: true, _notice: 'Email NOT sent...' }) as unknown as void`
**Risk:** The interface declares `Promise<void>`. The caster hides the failure signal. Every caller that `await`s `sendDraft()` sees no exception and assumes success.
**Fix:** Throw `NotConfiguredError` instead. If the interface truly returns void, failure must be signaled by throwing.

### C3. VoicePipeline falls back to MockVoiceProvider silently

**File:** `packages/voice/src/pipeline/voice-pipeline.ts:39-40`
**Pattern:** `fallbackProviders: [VoiceProvider.DEEPGRAM, VoiceProvider.MOCK]`
**Risk:** If Deepgram fails, the pipeline silently uses mock transcripts. User thinks voice works.
**Fix:** Remove `VoiceProvider.MOCK` from the default fallback chain. If Deepgram fails, return a visible error.

### C4. DraftSocialAdapter returns `success: true` despite not posting

**File:** `packages/tools/src/adapters/social/draft-social.adapter.ts:20-38`
**Pattern:** `return { success: true, draft: {...} }`
**Risk:** LLM caller sees `success: true`, assumes the post went live. Must inspect `draft` field to know it's a draft. `/social` hub page even has a "Publish" button that calls this adapter.
**Fix:** Return `{ posted: false, draftCreated: true, draft: {...} }` so the signal is explicit in the top-level key name.

### D1. Reddit card shown as available on `/social` hub

**File:** `apps/web/src/app/(dashboard)/social/page.tsx:92` + `packages/tools/src/adapters/social/social-factory.ts:35-39`
**Pattern:** Reddit card renders identically to LinkedIn/X/HN. `getRedditAdapter()` always returns `DraftSocialAdapter('reddit')` — no OAuth path exists.
**Risk:** Users click Draft → Publish on Reddit and think they posted. Actually just stored a draft.
**Fix:** Either (a) add `requiredProvider: 'REDDIT'` + a connect flow, (b) mark the card with a clear "Draft-only (publishes go to clipboard)" badge, or (c) remove the card.

### C5. MockCalendarAdapter.deleteEvent() returns fake success

**File:** `packages/tools/src/adapters/calendar/mock-calendar.adapter.ts:209-220`
**Pattern:** `console.warn('Event NOT actually deleted...')` then returns fake success object.
**Risk:** `console.warn` is easy to miss in production logs. LLM gets "deleted" confirmation.
**Fix:** Throw `NotConfiguredError`.

### C6. UnconfiguredCRMAdapter returned silently

**File:** `packages/tools/src/adapters/adapter-factory.ts:17-42` + `packages/tools/src/adapters/unconfigured.ts`
**Pattern:** When no real CRM is configured, returns `UnconfiguredCRMAdapter` which throws. Good, BUT the adapter factory doesn't distinguish "not configured" from "misconfigured" at tool-call time.
**Risk:** Agent picks up CRM tool, invokes it, gets a cryptic error. Better UX: tool should not be offered at all if no CRM is configured.
**Fix:** Gate `WORKER_CRM` tool registration on `hasRealCRMAdapter()` check.

### D2. `send_email` tool strips `_notice` from mock response

**File:** `packages/tools/src/builtin/index.ts:103-106` + `186-190`
**Pattern:** Tool metadata says `maturity: 'config_dependent'` but the handler at line 186-190 returns `{ success: true }` when MockEmailAdapter embeds `_notice: 'Email NOT sent'`.
**Risk:** LLM gets `{ success: true }` and tells the user "Email sent!" — it wasn't.
**Fix:** Update handler to check for `_notice` / `_mock` fields and propagate failure to the LLM.

### C7. MockEmailAdapter.draftReply() returns success with `_notice` in shadow field

**File:** `packages/tools/src/adapters/email/mock-email.adapter.ts:244-258`
**Pattern:** Same as C2 but for drafts.
**Risk:** Draft looks created but isn't in Gmail. Dashboard might show "Draft saved" card.
**Fix:** Throw `NotConfiguredError` OR return a strongly-typed error object the caller must handle.

### D3. `maturity: 'config_dependent'` mask for mock fallback

**File:** `packages/tools/src/builtin/index.ts:103`
**Pattern:** Operators see `config_dependent` in the tool registry and assume missing config → tool fails loudly. In practice, MockEmailAdapter silently returns fake data.
**Risk:** Misleading maturity signal — suggests tool is "ready, just needs config" when the "not configured" path is a silent mock.
**Fix:** When all adapters for a tool resolve to mock-only, downgrade maturity to `'placeholder'` and flag it in `/admin/diagnostics`.

## Category B — safe production fallbacks (no fix needed)

Documented, loud, or intentionally throw:

- `packages/tools/src/adapters/unconfigured.ts` — every method throws `NotConfiguredError` with "set GMAIL_EMAIL + GMAIL_APP_PASSWORD" hint. **Safe.**
- `packages/agents/src/runtime/model-resolver.ts:82-90` + `143-159` — `FAILSAFE_MAP` (gpt-4o family) returned on capability check failure. **Safe** — logs `[ModelResolver] Capability check failed` at WARN level.
- `apps/api/src/routes/integrations.routes.ts:19-103` — `INTEGRATION_MATURITY` map explicitly labels providers as `'production-ready' | 'beta' | 'partial' | 'placeholder'`. **Safe** — transparent labeling.
- `packages/tools/src/adapters/adapter-factory.ts:18-42` — `getEmailAdapter` / `getCalendarAdapter` return unconfigured stubs with env-var hints. **Safe.**

## Category A — test/dev code (ignore)

- `packages/voice/src/providers/mock.provider.ts:47` — `MockVoiceProvider` is intentional test fixture. **A** (but note C3 — it's in the prod fallback chain, which is the bug).
- `packages/agents/src/benchmarks/harness.ts:1-23` — benchmark harness is in-process, no network. **A**.

## Summary counts

| Category | Count | Action |
|---|---|---|
| A — test/dev code | 2 files | None |
| B — safe production | 5 locations | None (already documented) |
| **C — dangerous fake prod** | **7 findings** | **Fix before next deploy** |
| **D — UI not backed by backend** | **3 findings** | **Fix or label honestly** |

## Recommended fix ordering (minimum safe sequence)

Ranked by blast radius × ease:

1. **C3 voice mock fallback** — one-line removal from fallback chain. Highest-leverage honesty win.
2. **C1 + C2 + C5 + C7** (all four mock adapter "silent success" cases) — rewrite the four methods to throw `NotConfiguredError`. One commit, contained to `packages/tools/src/adapters/{calendar,email}/mock-*.adapter.ts`.
3. **D2 send_email handler** — 10-line change in `packages/tools/src/builtin/index.ts` to propagate `_notice` / `_mock` flags.
4. **C4 + C6** — `DraftSocialAdapter` shape change + CRM tool registration gate. Touches tools registry.
5. **D1 Reddit card** — either add connect flow or add explicit "draft-only" badge on `/social` page.
6. **D3 maturity labeling** — downgrade `config_dependent` to `placeholder` when only mock resolves. Admin-facing.

**None of these are rewrites — each is a contained patch in one or two files.**

The runtime layer itself (OpenAI, ModelResolver, BaseAgent, ProviderRouter) has **zero category C or D findings**. The fake/dummy problem is concentrated in the **tool adapters** that were built before the product had real integrations — they were helpful stand-ins during dev, but they now misrepresent real behavior to users.
