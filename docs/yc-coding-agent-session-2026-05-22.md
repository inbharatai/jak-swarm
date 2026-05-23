# YC Optional Attachment: Coding Agent Session (2026-05-22)

## Session title
CI incident response: OAuth provider expansion caused integration route collision; fixed and shipped to main in two commits.

## Why this session matters
This session shows practical AI-agent usage under production pressure:
- A real CI break on mainline tests
- Fast root-cause isolation
- Minimal-risk fixes
- Full verification with the same test slices CI runs
- Immediate push with clean commit history

## Repo and branch context
- Repository: inbharatai/jak-swarm
- Branch: main
- Final head after fix: 72c5c5e

## Problem statement
A provider registry update added DRIVE sharing Google's callback path. Unit tests were updated first, but CI integration then failed with duplicate Fastify route registration:

- Error: FastifyError: Method GET already declared for route /integrations/oauth/google/callback
- Failure surface: integration route registration in API bootstrap

## Investigation trail
1. Confirmed provider registry includes both GMAIL and DRIVE with the same callback path.
2. Confirmed callback routes were mounted in a loop per provider, causing duplicate app.get(...) declarations when paths match.
3. Verified callback provider identity is resolved from stored OAuth state, not path-only inference, so deduping registration is safe.

Key files inspected:
- apps/api/src/services/oauth-providers.ts
- apps/api/src/routes/integrations.routes.ts
- tests/unit/services/oauth-providers.test.ts

## Changes shipped

### Commit 1
- Commit: 910e442
- Message: test: align oauth provider expectations for drive
- File changes:
  - tests/unit/services/oauth-providers.test.ts (+18, -5)

What changed:
- Added DRIVE to expected provider sets.
- Replaced strict callback uniqueness assertion with explicit shared-google-path policy:
  - Expected shared path: /integrations/oauth/google/callback
  - Expected providers on shared path: DRIVE, GMAIL

### Commit 2
- Commit: 72c5c5e
- Message: fix(api): dedupe shared oauth callback route registration
- File changes:
  - apps/api/src/routes/integrations.routes.ts (+3)

What changed:
- Introduced a Set to dedupe callback route registration by path before calling app.get(...).
- Preserved shared handler behavior.

Patch core:

```ts
const registeredCallbackPaths = new Set<string>();
for (const provider of Object.values(OAUTH_PROVIDERS)) {
  if (registeredCallbackPaths.has(provider.callbackPath)) continue;
  registeredCallbackPaths.add(provider.callbackPath);
  app.get(provider.callbackPath, handleOAuthCallback);
}
```

## Verification executed
1. Integration slice matching CI failing area:

```bash
pnpm --filter @jak-swarm/tests exec vitest run integration --exclude **/circuit-breaker.test.ts --exclude **/truth-claims.test.ts
```

Result:
- Passed
- 24 test files passed
- 274 tests passed
- 99 skipped
- Duplicate-route Fastify error absent

2. Regression slice used in prior CI checks:

```bash
pnpm --filter @jak-swarm/tests exec vitest run --coverage unit integration/circuit-breaker.test.ts integration/truth-claims.test.ts
```

Result:
- Passed
- 137 test files passed
- 1885 tests passed

## Outcome
- CI-blocking integration failure resolved
- Tests updated to match intended provider behavior
- Runtime made robust to shared callback paths
- Fix merged directly to main with isolated, reviewable commits

## What this demonstrates about AI coding-agent usage
- The agent was used for end-to-end execution, not autocomplete-only coding.
- The workflow was production-minded: triage -> patch -> validate -> ship.
- The fix was minimal and safety-preserving, with explicit regression checks.
- The output was actionable under time pressure and reduced mean-time-to-recovery.
