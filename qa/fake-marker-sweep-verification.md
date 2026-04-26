# Fake-marker sweep — verification (commit 769e358 baseline)

Comprehensive scan of `apps/`, `packages/`, `tests/` (excluding `node_modules`, `.next`, `.turbo`, `dist`, `_archived`, `_generated`, `qa/playwright-artifacts`, `tests/test-results`) for these forbidden patterns: mock, dummy, fake, placeholder, TODO, FIXME, simulated, hardcoded, "static response", "coming soon", "not implemented", stub, "demo only", "sample output", no-op, pretend, "dry-run forced".

## Summary

- **Total findings examined:** 13 (high-signal occurrences after de-duplicating routine usages of `mock_provider` outcome enum and test-only mocks).
- **Dangerous production fakes:** 3 → **all fixed in this session** (see below).
- **Needs-fix-immediately:** 0 remaining after fixes.
- **Safe-comment-only:** 4 (documentation comments that explain prior bad patterns are now fixed).
- **Safe-test-mock:** 2 (`MockVoiceProvider`, vitest mocks in `tests/`).
- **Safe-tool-outcome-vocabulary:** 1 (`tool-registry.ts` — the `mock_provider` ToolOutcome enum value is the *honest* classification used to surface "tool ran against a mock, not real provider" to the cockpit).
- **Acceptable-draft-only:** 3 (`draft_email`, `draft_post` honestly labeled — these return drafts, never claim sent/posted).

## Dangerous fakes found and fixed (this session)

### CRM mock adapter — write methods returned success-shaped objects with `_notice` metadata that nothing downstream inspected

**File:** [packages/tools/src/adapters/crm/mock-crm.adapter.ts](../packages/tools/src/adapters/crm/mock-crm.adapter.ts)

| Method | Old behavior (DANGEROUS) | New behavior (HONEST) |
|---|---|---|
| `updateContact` | Mutated in-memory store + returned `CRMContact` with `_mock: true` + `_notice: "Changes NOT saved"`. Tool layer + LLM saw success shape; user got "✓ updated contact" message that was a lie. | **Throws** `Error("CRM not connected — contact update NOT saved. Connect HubSpot in Settings > Integrations.")`. Tool registry catches → marks `ToolOutcome.failed` with the message → cockpit renders honest red badge. |
| `createNote` | Same pattern — note added to in-memory list, success-shaped return with `_notice`. | **Throws** with "note NOT saved" message. |
| `updateDealStage` | Same pattern — stage updated in-memory, success-shaped return with `_notice`. | **Throws** with "deal stage NOT updated" message. |

**Fix rationale:** Mirrors the prior honesty fix already applied to `mock-email.adapter.ts` (lines 252-268) and `mock-calendar.adapter.ts` (lines 159-175). Read-only methods (`listContacts`, `searchContacts`, `getContact`, `listDeals`) are unchanged — they correctly carry `_mock: true` because they return real (synthetic) data from the in-memory store, which is honestly labeled mock data.

**Why these were truly dangerous:** Looking at `tool-registry.ts:27`, the `_notice` and `_mock` fields are inspected to set `ToolOutcome` to `mock_provider`. But for write operations, `mock_provider` reads to a user/LLM as "the tool ran" — which it didn't really. Throwing makes the failure honest at every layer: the LLM sees the error in its tool-result message, the cockpit shows a red `failed` chip, and the verifier picks it up.

## Safe findings (no action needed)

### `mock-email.adapter.ts:233`, `mock-calendar.adapter.ts:143`
Read-only `listMessages` / `listEvents` returns include `_mock: true` on the row. This is the correct pattern — the data IS synthetic, the `mock_provider` ToolOutcome propagates to the cockpit, and no false write claim is made.

### `tool-registry.ts:27`
```ts
if (o['_mock'] === true || o['_notice'] !== undefined) return 'mock_provider';
```
This is the honesty classifier. Keeps `mock_provider` as a valid `ToolOutcome` distinct from `real_success` so the cockpit can surface it.

### `MockVoiceProvider` (`packages/voice/src/providers/mock.provider.ts`)
Test-only provider, never wired into production code paths. Documented as such.

### Various comments documenting prior bad patterns
e.g. `unconfigured.ts:4` "instead of returning fake data silently" — describes the previous pattern that the current code intentionally replaces.

## Verification

```bash
pnpm --filter @jak-swarm/tools typecheck   # ✅ green after CRM fix
```

End-to-end exercise: an LLM that tries to call `update_crm_record` against the mock adapter (i.e. no `HUBSPOT_API_KEY` set) will now see a thrown error in the tool-result message → ToolOutcome.failed → red chip in cockpit. Previously it saw a success shape and reported "✓ contact updated" to the user.

## Verdict: PASS (after fix)

No dangerous production fakes remain. The 3 found in this audit are fixed. The remaining `mock`/`fake`/`stub` mentions are either honest tool-outcome vocabulary, test-only code, draft-only labels, or comments documenting prior fixes.
