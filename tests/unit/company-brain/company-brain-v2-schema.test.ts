import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Resolve from the test file location, not process.cwd(): vitest runs this
// file from the @jak-swarm/tests package working directory, so cwd-relative
// paths point at tests/packages/db/... which does not exist.
const REPO_ROOT = join(__dirname, '../../..');

const migration = readFileSync(
  join(REPO_ROOT, 'packages/db/prisma/migrations/118_company_brain_graph_v2/migration.sql'),
  'utf8',
);
const schema = readFileSync(
  join(REPO_ROOT, 'packages/db/prisma/company-brain-v2.prisma'),
  'utf8',
);

const expectedTables = [
  'company_artifact_policies',
  'company_entity_aliases',
  'company_claims',
  'company_claim_evidence',
  'company_edges',
  'company_entity_merges',
  'company_memory_reviews',
];

describe('Company Brain Graph V2 migration contract', () => {
  it('maps every additive database table into the multi-file Prisma schema', () => {
    for (const table of expectedTables) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
      expect(schema).toContain(`@@map("${table}")`);
    }
  });

  it('keeps truth, access, and graph constraints in the database', () => {
    expect(migration).toContain('company_claims_status_check');
    expect(migration).toContain('company_edges_not_self_check');
    expect(migration).toContain('company_artifact_policies_visibility_check');
    expect(migration).toContain('company_memory_reviews_open_resource_key');
  });
});
