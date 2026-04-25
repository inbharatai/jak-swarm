# Security secret rotation checklist

**Date:** 2026-04-25
**Trigger:** Two assistant sessions accidentally exposed live credentials in chat output. Operator confirmed those credentials have been rotated. This document codifies the rotation procedure for future incidents and the safe-logging conventions that prevent recurrence.

## When to use this checklist

Use this whenever any of these is true:
- A secret value appeared in chat, terminal output, an error message, or a stack trace.
- A credential was checked into git (even if reverted — it's still in history).
- A teammate left or had their machine compromised.
- A third-party provider notifies you of a breach affecting your account.

The cost of an unnecessary rotation is ~30 minutes. The cost of a missed rotation is unlimited. **When in doubt, rotate.**

## Per-secret rotation steps

### OpenAI API key (`OPENAI_API_KEY`)

1. https://platform.openai.com/api-keys → Revoke the leaked key.
2. Click "+ Create new secret key" → name it descriptively (e.g. `jak-swarm-prod-2026-04-26`).
3. Copy the new key value (shown ONCE).
4. Update each location:
   - Local: `apps/api/.env` line `OPENAI_API_KEY=...`
   - Render: dashboard → service → Environment → edit `OPENAI_API_KEY`
   - Vercel: dashboard → project → Settings → Environment Variables → edit `OPENAI_API_KEY` (preview + production)
   - GitHub Actions: Settings → Secrets and variables → Actions → `OPENAI_API_KEY` → Update
5. Restart the Render service so it picks up the new key.
6. Verify: `curl https://jak-swarm-api.onrender.com/version` shows `openaiApiKeySet: true`.

### Supabase database password (`DATABASE_URL` + `DIRECT_URL`)

1. https://supabase.com/dashboard → project → Settings → Database → "Reset database password".
2. Copy the new password (shown ONCE).
3. Construct new URLs (the host + user stay the same; only the password changes):
   - Pooled: `postgresql://postgres.<project-ref>:<NEW-PASSWORD>@aws-1-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true`
   - Direct: `postgresql://postgres.<project-ref>:<NEW-PASSWORD>@aws-1-<region>.pooler.supabase.com:5432/postgres`
4. Update each location:
   - Local: `apps/api/.env` lines `DATABASE_URL=` and `DIRECT_URL=`
   - Render: edit both env vars → restart service
   - Vercel: edit both env vars (preview + production)
   - GitHub Actions secrets if present (`DATABASE_URL_TEST` etc.)
5. Verify: `pnpm prisma db pull` succeeds locally; `/health` returns `db: ok` on Render.
6. **Audit who else has the old credential**: any local checkout, any laptop, any teammate.

### Redis URL (`REDIS_URL`)

1. https://console.upstash.com/ → database → Settings → Reset password.
2. Copy the new full URL (Upstash shows it pre-formatted with new password).
3. Update each location:
   - Local: `apps/api/.env` line `REDIS_URL=...`
   - Render: edit env → restart service
   - Vercel: edit env if used there
4. Verify: `/health` returns `redis: ok` on Render.

### `AUTH_SECRET` (JWT signing secret)

⚠ Rotating this **invalidates every active user session** — every user must log in again. Plan accordingly.

1. Generate a new secret (≥32 random bytes): `openssl rand -base64 48`.
2. Update each location:
   - Local: `apps/api/.env` line `AUTH_SECRET=...`
   - Render: edit env → restart service
   - Vercel: edit env (preview + production) — same value
   - GitHub Actions: edit `AUTH_SECRET` if used
3. Restart Render service. All existing JWTs become invalid.
4. Notify users they need to sign in again (or accept silent re-login on next visit).

### Render / Vercel / worker environment

These platforms use the same env vars as above. The point of this section: **don't forget the secondary surfaces**:
- Render worker service (separate from API service) — `srv-d7eed8l8nd3s73bcjv30` for API, check for separate worker srv-id
- Vercel preview deployments retain their own env snapshot — verify the rotation took effect for preview
- Render cron jobs / scheduled tasks if any
- Render shell preview sessions (manually `kill 9` and restart)

### Local `.env` files

After rotating any of the above, also:
1. Update `apps/api/.env` (the only env file currently used locally for the API)
2. Update root `.env.local` if it carries any of the rotated keys
3. Confirm `.env.example` (tracked) carries placeholders ONLY, never real values

### GitHub Actions secrets

`.github/workflows/bench-runtime.yml` references `OPENAI_API_KEY` from repository secrets. After rotation:
1. Settings → Secrets and variables → Actions → click each affected secret → Update value
2. Re-run any failed workflow runs

## Safe-logging conventions (prevention)

Following these rules prevents the next leak.

### Don't do this

```bash
# WRONG: prints the value
echo $OPENAI_API_KEY
cat .env.local
grep OPENAI .env

# WRONG: my session bug — `&` includes the matched value
sed 's/=.*/=<redacted-len=&>/' .env

# WRONG: prints the value to logs
console.log('Using key:', process.env.OPENAI_API_KEY);
logger.info({ env: process.env }, 'startup');
```

### Do this

```bash
# RIGHT: presence check, length only
[ -n "$OPENAI_API_KEY" ] && echo "set (len=${#OPENAI_API_KEY})"

# RIGHT: redact properly with sed
sed 's/=.*/=<redacted>/' .env

# RIGHT: filenames + presence only
grep -lE "^OPENAI_API_KEY=" .env*

# RIGHT: log presence + length, never the value
logger.info({
  openaiKeySet: Boolean(process.env.OPENAI_API_KEY),
  openaiKeyLen: process.env.OPENAI_API_KEY?.length ?? 0,
}, 'startup');
```

### Convention list

1. **Never `echo`, `cat`, or `print` an env file's contents.** Use `grep -l` (filenames only) or `wc -c` (byte counts).
2. **In `sed`, never use `&` in the replacement** — it inserts the matched string. Use `<redacted>` literal.
3. **In application code**, log presence (`Boolean(value)`) and length (`value.length`), never the value.
4. **In CI**, mask any secret-shaped string output with `::add-mask::` before printing it. GitHub Actions automatically masks the value of any secret declared in `secrets.*` ONLY IF it's read via that path — direct env vars are not masked.
5. **In tests**, never inline real credentials. Use `process.env.E2E_AUTH_PASSWORD` and require operators to supply at run time.
6. **In docs / READMEs / comments**, use `<your-key-here>` placeholders. Don't paste real-looking examples.

## Repo audit (post-rotation)

Run these to confirm no stale credentials remain in the codebase:

```bash
# Check tracked files for OpenAI key shapes
git grep -nE "sk-[A-Za-z0-9_-]{30,}"
git grep -nE "sk-svcacct"

# Check tracked files for DB URL shapes with embedded passwords
git grep -nE "postgresql://[^@]+:[^@]+@"

# Check tracked files for Redis URLs
git grep -nE "rediss?://[^@]+@"

# Check that .env files are properly ignored
git ls-files | grep -E "\.env(\.|$)" | grep -v "\.example$"
# Should print NOTHING (only .env.example files allowed)

# Run the full gitleaks scan (CI does this, but you can re-run locally)
# Install gitleaks → https://github.com/gitleaks/gitleaks
gitleaks detect --config .gitleaks.toml
```

Status of the above checks at this commit:

- `git grep` for `sk-svcacct` → matches in chat-transcript artifacts only (not in tracked source). The leaked OpenAI key existed only in `apps/api/.env` which is gitignored.
- `git grep` for `postgresql://...:...@` → only matches are CI test creds (`postgresql://jakswarm:jakswarm@localhost:5432/jakswarm`), which are intentional test fixtures.
- `git grep` for the leaked DB password `Adubaby` → was found in `tests/e2e/qa-world-class.spec.ts:13` as part of a usage-comment example. **Removed in this commit.**
- `git ls-files | grep -E "\.env"` → returns only `.env.example` files (allowed) and the new `.gitignore`-listed `.env` patterns block future commits.

## What changed in this commit

1. `tests/e2e/qa-world-class.spec.ts:13` — removed inline `Adubaby.004!` credential pattern; replaced with `<your-password>` placeholder + a comment forbidding future inlining.
2. `.gitignore` — added explicit `apps/*/.env` and `packages/*/.env` patterns so the original mistake (`apps/api/.env` slipping past root `.env`) cannot recur.
3. This document.
