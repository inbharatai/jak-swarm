# Credential Rotation Runbook

Treat any credential that was ever exposed as **compromised** and rotate it. This runbook covers every external credential JAK Swarm uses and the exact steps to rotate each — plus how to keep the rotation from breaking production.

## When to use this runbook

Any of the following triggers a rotation:

1. A credential was pasted into a chat, issue, commit message, PR description, screenshot, or Slack message.
2. A laptop that held the credential is lost, stolen, or known-compromised.
3. A team member who had access leaves.
4. Gitleaks / CI secret scan fires on the credential shape.
5. You don't know when it was last rotated (≥ 90 days is a rotation trigger for high-risk creds).

If there is *any* doubt: rotate. Rotating is cheap; a leak in the wild is expensive.

---

## 0. Pre-rotation checklist (do this once, before your first rotation)

- [ ] Identify your secret manager. The recommended options for JAK Swarm deployments:
  - **Render** — use the dashboard Environment Variables panel (encrypted at rest, not visible after save).
  - **Vercel** — Project Settings → Environment Variables.
  - **Cloud provider secrets** — AWS Secrets Manager, GCP Secret Manager, Doppler.
  - **Local dev** — `.env.local` (already gitignored; never commit).
- [ ] Confirm the secret manager can hot-reload your API process (Render auto-restarts on env change; Vercel triggers a new deploy).
- [ ] Have the `pnpm --filter @jak-swarm/api start` log tailing so you can confirm the new credential is accepted on the next boot.

---

## 1. CRITICAL — Supabase service token (leaked 2026-04-18)

This token was pasted into a chat session on 2026-04-18 and is considered compromised regardless of whether JAK wired Supabase at that time.

**Rotation steps:**

1. Log in to https://supabase.com.
2. Open the project → **Project Settings** → **API**.
3. Click **Regenerate service_role key**. This invalidates the leaked token **immediately**.
4. If `SUPABASE_SERVICE_ROLE_KEY` is referenced anywhere in your deployment env, update it there (Render / Vercel / secret manager).
5. If the same project also used an `anon` key that was exposed, rotate it too (same panel).
6. Redeploy any service that consumed the old token.

**Verification:**

- Any request using the old token should now return `401` with `"code": "invalid_token"`.
- If no runtime depends on it today: item is still closed because the token is rotated.

---

## 2. OpenAI (`OPENAI_API_KEY`)

Used for: GPT-4o default chat, DALL-E image generation, Whisper transcription, GPT-4o vision (browser_analyze_page, screenshot-to-code).

**Rotation steps:**

1. https://platform.openai.com/api-keys
2. Find the key by its label (e.g. `jak-swarm-production`).
3. **Revoke** the old key. This is instant.
4. Click **Create new secret key** → copy it.
5. Update `OPENAI_API_KEY` in your secret manager / Render / Vercel.
6. Rolling restart the API process.

**Verification:** `curl https://api.openai.com/v1/models -H "Authorization: Bearer $NEW_KEY"` returns `200`. JAK fallback will quietly route to Anthropic if OpenAI fails, so watch the logs for "OpenAI" errors after the swap.

**Blast radius if leaked:** high — the key can drive unbounded spend.

---

## 3. Anthropic (`ANTHROPIC_API_KEY`)

Used for: Claude Opus tier-3 routing (Architect, Technical, Strategist), Claude Haiku re-ranker.

**Rotation steps:**

1. https://console.anthropic.com/settings/keys
2. Revoke the old key.
3. Generate new, copy, update env, restart.

**Verification:** re-run `pnpm bench:search` (uses Haiku re-ranker) — no 401 errors in log.

**Blast radius if leaked:** high — Anthropic Opus is the most expensive routed model.

---

## 4. Serper (`SERPER_API_KEY`)

Used for: primary production search provider.

**Rotation steps:**

1. https://serper.dev/account
2. Regenerate key. Serper doesn't allow revocation without regeneration.
3. Update env, restart.

**Verification:** `pnpm bench:search` runs; the provider chain reports Serper as the winning primary.

**Blast radius if leaked:** medium — pay-per-query, caps in dashboard. Raise a hard cap immediately after any suspected leak.

---

## 5. Tavily (`TAVILY_API_KEY`)

Used for: secondary search fallback.

**Rotation steps:** https://app.tavily.com/home → API Keys → rotate. Update env, restart.

**Blast radius if leaked:** medium.

---

## 6. GitHub (`GITHUB_PAT`)

Used for: `github_create_repo`, `github_push_files`, `github_review_pr` tools.

**Rotation steps:**

1. https://github.com/settings/tokens
2. Delete the old PAT.
3. Generate new (fine-grained personal access token, or classic with `repo` scope only if fine-grained can't express your needs).
4. Update env, restart.

**Verification:** call `GET /user` via the tool or curl to confirm auth.

**Blast radius if leaked:** **critical** — PATs can push to any repo you have access to. Rotate within minutes of suspected leak. If the PAT had repo-write on any private repo, audit the commit history of those repos for unauthorized changes.

---

## 7. Vercel (`VERCEL_TOKEN`)

Used for: `AppDeployer` agent deploying generated apps.

**Rotation steps:**

1. https://vercel.com/account/tokens
2. Delete the old token.
3. Create a new scoped token (team/project scope if possible).
4. Update env, restart.

**Verification:** re-run an `AppDeployer` workflow in staging; check the returned `deploymentUrl`.

**Blast radius if leaked:** high — Vercel tokens can deploy or delete projects and domains.

---

## 8. Gmail (`GMAIL_EMAIL` + `GMAIL_APP_PASSWORD`)

Used for: IMAP/SMTP email worker.

**Rotation steps:**

1. https://myaccount.google.com/apppasswords
2. Revoke the old app password.
3. Generate a new app password labeled `jak-swarm`. **Copy the 16-character password immediately — Google never shows it again.**
4. Update `GMAIL_APP_PASSWORD` in env.
5. Restart.

**Verification:** run the email worker against a test inbox (`action: 'READ'`). Expect a successful IMAP connection.

**Blast radius if leaked:** high — app passwords have full IMAP + SMTP access.

---

## 9. CalDAV credentials

Used for: Google Calendar worker.

**Rotation steps:**

1. Same app-password flow as Gmail.
2. Update the CalDAV creds in env.
3. Restart.

---

## 10. Slack (`SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`)

Used for: Slack channel bridge.

**Rotation steps:**

1. https://api.slack.com/apps → select your JAK app.
2. For `SLACK_SIGNING_SECRET`: **Basic Information → App Credentials → Regenerate**. This invalidates the old one immediately.
3. For `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN`: **Install App** → reinstall → copy the new tokens.
4. Update env, restart.

**Verification:** send a message to the bridge channel; confirm JAK receives the event with a valid signature.

**Blast radius if leaked:** medium-high — signing secret allows an attacker to forge events that JAK processes as legitimate.

---

## 11. Webhook secrets (WhatsApp bridge, external webhooks)

`WHATSAPP_BRIDGE_TOKEN` and any other shared-secret webhook keys.

**Rotation steps:**

1. Generate a new secret: `openssl rand -base64 32`.
2. Update both sides (JAK env AND the webhook sender's configured secret).
3. Restart.

**Verification:** send a test webhook, confirm signature validation passes.

---

## 12. Database credentials (`DATABASE_URL`)

Rotate when:
- DB host was changed / migrated.
- A DB admin who had password access leaves.
- Connection string was ever pasted / shared.

**Steps depend on provider** — Supabase / Render Postgres / AWS RDS each have their own flow. Use the provider's "Reset password" panel. Then update `DATABASE_URL` in env and restart. Test with `pnpm --filter @jak-swarm/db prisma:introspect`.

**Blast radius if leaked:** **critical** — direct DB access means customer data exposure.

---

## 13. AUTH_SECRET (session JWT signing)

Never ships to clients. Used to sign session JWTs.

**Rotation steps:**

1. Generate: `openssl rand -base64 32`.
2. Update env, restart.

**Consequence:** every currently-active session invalidates — users must re-login. Plan rotation during a low-traffic window OR rotate in a staged way (support both old and new secrets briefly).

---

## 14. Things JAK doesn't use but might appear

If any of these appear in a leak scan, they weren't added by JAK but should still be handled:

- **AWS keys (AKIA..., ASIA...)** — IAM → deactivate → rotate via AWS CLI or console
- **GCP service-account JSON** — IAM → disable key → create new → swap
- **Stripe** (`sk_live_`, `rk_live_`) — Stripe Dashboard → Developers → API keys → roll
- **Sentry / DataDog / Posthog** — each provider's dashboard

---

## How to keep future credentials from leaking

Already wired in this repo:

- `.gitignore` excludes `.env` and `.env.*.local`.
- `.gitleaks.toml` + `gitleaks-action` in CI scans every PR (blocks merge on hit).
- `security-gate` CI job greps for real-looking secret patterns in source files.
- `check:truth` CI verifies no secret-shaped strings leaked into documentation.

Additionally consider:

- Add `gitleaks` to a local pre-commit hook: `brew install gitleaks && gitleaks protect --staged`.
- Never paste a credential into a chat (including AI chats). If you must share, redact the middle: `sk-proj-abc...xyz`.
- Rotate any credential that survives past 90 days on a schedule, not reactively.

---

## Emergency playbook: "I just leaked a key"

Execute in this exact order:

1. **Revoke** the key at the provider (see relevant section above). Do this in the **first 5 minutes**.
2. **Replace** the key in your deployment env.
3. **Redeploy** the service that consumed it.
4. **Audit** provider logs for any unauthorized use since the leak. Save evidence.
5. **Report** the leak internally per your own process (security@yourcompany or equivalent).
6. **Remove** the key from the transcript / commit / message where it leaked (if possible). If it's in a public git history, perform a history rewrite:

   ```bash
   # Only run with explicit authorization — this rewrites shared history.
   git clone --mirror <repo-url>
   cd <repo>.git
   # Use git-filter-repo (faster + safer than filter-branch):
   git filter-repo --replace-text replacements.txt
   # Then force-push:
   git push --mirror --force
   ```

   Where `replacements.txt` contains one `literal==>REDACTED` line per leaked secret. This still cannot recover any use that already happened, so the rotation above must come first.

7. **Close the loop**: update this runbook with any lesson learned.

---

## Current outstanding rotations

As of 2026-04-19:

| Credential | Status | Owner action |
|---|---|---|
| Supabase service_role (leaked 2026-04-18) | **Outstanding** — rotate now | Section 1 |
| Any other | — | Inspect chat / commit history for the last 90 days; rotate anything that appeared |
