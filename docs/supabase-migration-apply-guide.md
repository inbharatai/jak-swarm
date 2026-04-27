# Supabase migration apply guide — Migration 16 + 99

Project: `ttrhawuqydfecndehdhx.supabase.co`

Two new migrations need to be applied to the production Supabase database to bring it in sync with the latest commit. Both are **additive** — no data is dropped, no existing column is changed.

## What's being added

| Object | Purpose | Migration |
|---|---|---|
| `company_profiles` (table) | Per-tenant CompanyProfile (name, industry, brand voice, products, competitors, pricing, goals, constraints, status, extractionConfidence) | `16_company_brain_intent_templates` |
| `company_knowledge_sources` (table) | Per-tenant tracked URLs for ingestion (kind, lastCrawledAt, status) | `16_company_brain_intent_templates` |
| `intent_records` (table) | Persisted Commander intent classifications | `16_company_brain_intent_templates` |
| `workflow_templates` (table) | Pre-tuned workflow specifications, tenant-overridable | `16_company_brain_intent_templates` |
| `memory_items` columns: `status`, `suggestedBy`, `reviewedBy`, `reviewedAt` + index `(tenantId, status)` | Memory approval flow | `99_memory_item_status` |

## Recommended path: use Prisma CLI

This is the safest path — Prisma tracks applied migrations in the `_prisma_migrations` table and prevents double-apply.

```bash
# 1. Set the production DB URLs in your local shell (rotate these tokens
#    first if you suspect they've been exposed)
export DATABASE_URL='postgres://postgres:<password>@<host>:6543/postgres?pgbouncer=true&connection_limit=1'
export DIRECT_URL='postgres://postgres:<password>@<host>:5432/postgres'

# 2. Apply pending migrations
pnpm --filter @jak-swarm/db db:migrate:deploy

# 3. Optional: seed the system WorkflowTemplates (the API auto-seeds on
#    boot, but this is faster + idempotent)
pnpm seed:compliance     # legacy compliance frameworks (if not done)
# (no separate seed for Company Brain — the API boot-seeds 6 templates)
```

Expected output of step 2:
```
Applying migration `16_company_brain_intent_templates`
Applying migration `99_memory_item_status`
Database is in sync with the migrations.
```

If migration 16 was previously partially applied (your CI run failed at 16), Prisma will detect this and refuse to apply. Resolve via:

```bash
# Mark the failed 16 as rolled back (the partial-apply created NO objects
# because the failure happened on the very first ALTER and Postgres rolled
# back the entire transaction)
pnpm --filter @jak-swarm/db exec prisma migrate resolve --rolled-back 16_company_brain_intent_templates
# Then re-apply
pnpm --filter @jak-swarm/db db:migrate:deploy
```

## Alternative path: paste SQL directly into Supabase SQL editor

If you don't have the Prisma CLI handy, you can paste the two migration files directly. **Only do this if Prisma's `_prisma_migrations` table is also updated manually** to record the migrations as applied — otherwise the next Prisma deploy will try to re-apply them and fail.

### Step 1 — apply migration 16

Paste the contents of [packages/db/prisma/migrations/16_company_brain_intent_templates/migration.sql](../packages/db/prisma/migrations/16_company_brain_intent_templates/migration.sql) into the Supabase SQL editor. Run.

### Step 2 — apply migration 99

Paste the contents of [packages/db/prisma/migrations/99_memory_item_status/migration.sql](../packages/db/prisma/migrations/99_memory_item_status/migration.sql) into the Supabase SQL editor. Run.

### Step 3 — record in `_prisma_migrations`

```sql
INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES
  (gen_random_uuid(), 'manual-apply', now(), '16_company_brain_intent_templates', 'Manually applied via SQL editor', NULL, now(), 1),
  (gen_random_uuid(), 'manual-apply', now(), '99_memory_item_status',            'Manually applied via SQL editor', NULL, now(), 1);
```

This step is critical — without it, `prisma migrate deploy` will try to re-apply on the next deploy and fail.

## Row-Level Security (RLS) notes

JAK Swarm uses **application-level tenant isolation** (every Prisma query filters by `tenantId` via middleware) — it does NOT use Supabase RLS policies. You can verify this by running:

```sql
-- Should return false for all jak-swarm tables
SELECT relname, relrowsecurity FROM pg_class
WHERE relname IN ('company_profiles', 'intent_records', 'workflow_templates', 'memory_items', 'audit_runs', 'workflows')
ORDER BY relname;
```

**If you want to add Supabase RLS as defense-in-depth**, the new tables should follow the same tenant-isolation pattern as existing tables. None of the existing tables (workflows, audit_runs, memory_items, etc.) currently have RLS enabled, so adding RLS only to the new tables would be inconsistent. Either:

- **Option A (recommended)**: leave RLS off for the new tables to match existing convention
- **Option B (defense in depth, future work)**: enable RLS on ALL tables in a coordinated change — requires updating the API to authenticate as a Supabase user with a JWT carrying the tenantId claim. Out of scope for this migration.

## Verification after apply

```sql
-- All 6 new tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('company_profiles', 'company_knowledge_sources', 'intent_records', 'workflow_templates')
ORDER BY table_name;
-- expect 4 rows

-- memory_items has the new columns
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'memory_items'
  AND column_name IN ('status', 'suggestedBy', 'reviewedBy', 'reviewedAt');
-- expect 4 rows

-- new index exists on memory_items
SELECT indexname FROM pg_indexes
WHERE tablename = 'memory_items' AND indexname = 'memory_items_tenantId_status_idx';
-- expect 1 row

-- Prisma migrations table reflects both migrations
SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
WHERE migration_name IN ('16_company_brain_intent_templates', '99_memory_item_status')
ORDER BY migration_name;
-- expect 2 rows, both with finished_at NOT NULL and rolled_back_at NULL
```

## After Supabase is updated — restart your API service

The API needs to restart so:
1. It picks up the new Prisma client (it was regenerated locally — Render will regenerate during the next deploy build)
2. The boot-time `WorkflowTemplate.seedSystemTemplates()` runs (6 system templates seeded idempotently)
3. The boot-time `BaseAgent.companyContextProvider` registration takes effect

```bash
# Render: trigger a manual redeploy of jak-swarm-api + jak-swarm-worker
# OR push the latest commit and let auto-deploy fire
```

## Honest verification

After all of the above, the following test should pass against the prod Supabase DB:

```bash
DATABASE_URL='postgres://...' pnpm --filter @jak-swarm/tests exec vitest run integration/company-os-foundation.test.ts
```

26 tests should pass — they verify the intent vocabulary, follow-up parser, document sanitizer, and AGENT_TIER_MAP recalibration. None of these tests need a database (they're pure-logic tests of the new modules), so the test passing only proves the CODE shipped — it does NOT prove the DB schema is correct. For DB verification, use the SQL queries in the "Verification after apply" section above.

---

**I cannot apply these migrations to your Supabase project from this side** — that requires production credentials I don't have access to (and shouldn't, per the security boundary). The two migration files are committed to the repo and ready to apply by you (or your CI/CD pipeline) using either path above.
