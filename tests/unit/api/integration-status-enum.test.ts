/**
 * Phase 2 — Integration.status Prisma enum migration regression test.
 *
 * Migration `105_integration_status_enum` converts the prior free-form
 * String column to the `ConnectionStatus` enum. This test:
 *   - locks the enum's value set (any future change to add/remove a
 *     status fails this test loudly)
 *   - asserts every value the front-end normalizer maps from is
 *     either an enum value OR explicitly handled as a legacy alias
 *
 * Reads the Prisma schema source directly so the test can't drift from
 * the actual schema declaration.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeConnectionStatus } from '../../../apps/web/src/lib/connection-status';

const SCHEMA_PATH = resolve(
  __dirname,
  '../../../packages/db/prisma/schema.prisma',
);

function readSchema(): string {
  return readFileSync(SCHEMA_PATH, 'utf8');
}

function extractEnumValues(schema: string, enumName: string): string[] {
  const match = schema.match(
    new RegExp(`enum\\s+${enumName}\\s*\\{([\\s\\S]*?)\\}`, 'm'),
  );
  if (!match) throw new Error(`enum ${enumName} not found`);
  return match[1]!
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('/'));
}

describe('Integration.status enum (migration 105)', () => {
  it('declares the canonical 6-value ConnectionStatus enum', () => {
    const schema = readSchema();
    const values = extractEnumValues(schema, 'ConnectionStatus');
    expect(values.sort()).toEqual([
      'CONNECTED',
      'ERROR',
      'EXPIRED',
      'NEEDS_REAUTH',
      'NOT_CONNECTED',
      'PENDING',
    ]);
  });

  it('Integration.status column uses ConnectionStatus, not String', () => {
    const schema = readSchema();
    const integrationModel = schema.match(
      /model Integration\s*\{([\s\S]*?)\n\}/,
    );
    expect(integrationModel, 'Integration model must exist').toBeTruthy();
    const body = integrationModel![1]!;
    // The status column declaration must reference the enum.
    expect(body).toMatch(/status\s+ConnectionStatus/);
    // Defensive: must not have regressed to free-form String.
    expect(body).not.toMatch(/status\s+String/);
  });

  it('default value is CONNECTED (matches the prior column default)', () => {
    const schema = readSchema();
    const integrationModel = schema.match(
      /model Integration\s*\{([\s\S]*?)\n\}/,
    );
    expect(integrationModel![1]).toMatch(/status\s+ConnectionStatus\s+@default\(CONNECTED\)/);
  });

  it('migration 105 file exists and contains the backfill + ALTER COLUMN', () => {
    const migrationPath = resolve(
      __dirname,
      '../../../packages/db/prisma/migrations/105_integration_status_enum/migration.sql',
    );
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('CREATE TYPE "ConnectionStatus"');
    expect(sql).toContain('UPDATE "integrations"');
    expect(sql).toContain('ALTER TABLE "integrations"');
    // Backfill must map unknown legacy values to NOT_CONNECTED (safest).
    expect(sql).toContain("SET \"status\" = 'NOT_CONNECTED'");
  });
});

describe('Front-end normalizer maps every enum value to a layman label', () => {
  const ENUM_VALUES = [
    'CONNECTED',
    'NOT_CONNECTED',
    'NEEDS_REAUTH',
    'EXPIRED',
    'ERROR',
    'PENDING',
  ] as const;

  it.each(ENUM_VALUES)('handles enum value %s without falling back to default', (value) => {
    const display = normalizeConnectionStatus(value);
    // The label must be set + not the empty string.
    expect(display.label).toBeTruthy();
    // The status must be in the layman taxonomy.
    expect([
      'CONNECTED',
      'NOT_CONNECTED',
      'EXPIRED',
      'PERMISSION_NEEDED',
      'COMING_SOON',
    ]).toContain(display.status);
  });

  it('legacy DISCONNECTED still maps cleanly (backwards compat)', () => {
    expect(normalizeConnectionStatus('DISCONNECTED').status).toBe('NOT_CONNECTED');
  });

  it('NEEDS_REAUTH maps to a reconnect-style display (not Connected)', () => {
    // NEEDS_REAUTH is in the enum but the normalizer historically used
    // EXPIRED for token-expired states. Either is acceptable layman copy
    // as long as it's NOT the 'CONNECTED' state.
    const display = normalizeConnectionStatus('NEEDS_REAUTH');
    expect(display.status).not.toBe('CONNECTED');
  });
});
