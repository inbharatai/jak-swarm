/**
 * Compliance framework seed — populates ComplianceFramework + ComplianceControl
 * tables from the catalogue in seed-data/compliance-frameworks.ts.
 *
 * Idempotent: re-runs upsert by (frameworkSlug) + (frameworkId, controlCode).
 * Safe to run after every deploy. Operator command:
 *
 *   pnpm seed:compliance
 *
 * NOT bundled with the main `db:seed` because that one creates demo
 * tenants + workflows; this one is global reference data that must
 * exist in every environment regardless of tenant fixtures.
 */

import { PrismaClient } from '@prisma/client';
import { FRAMEWORKS } from './seed-data/compliance-frameworks.js';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  let frameworksUpserted = 0;
  let controlsUpserted = 0;

  try {
    for (const fw of FRAMEWORKS) {
      const upsertedFw = await prisma.complianceFramework.upsert({
        where: { slug: fw.slug },
        create: {
          slug: fw.slug,
          name: fw.name,
          shortName: fw.shortName,
          issuer: fw.issuer,
          description: fw.description,
          version: fw.version,
          active: fw.active,
        },
        update: {
          name: fw.name,
          shortName: fw.shortName,
          issuer: fw.issuer,
          description: fw.description,
          version: fw.version,
          active: fw.active,
        },
      });
      frameworksUpserted++;

      for (const c of fw.controls) {
        await prisma.complianceControl.upsert({
          where: { frameworkId_code: { frameworkId: upsertedFw.id, code: c.code } },
          create: {
            frameworkId: upsertedFw.id,
            code: c.code,
            category: c.category,
            series: c.series,
            title: c.title,
            description: c.description,
            ...(c.autoRuleKey ? { autoRuleKey: c.autoRuleKey } : {}),
            ...(c.subControls && c.subControls.length > 0 ? { subControls: c.subControls as object } : {}),
            sortOrder: c.sortOrder,
          },
          update: {
            category: c.category,
            series: c.series,
            title: c.title,
            description: c.description,
            autoRuleKey: c.autoRuleKey ?? null,
            subControls: c.subControls && c.subControls.length > 0 ? (c.subControls as object) : null,
            sortOrder: c.sortOrder,
          },
        });
        controlsUpserted++;
      }

      // eslint-disable-next-line no-console
      console.log(`✓ Upserted framework "${fw.slug}" with ${fw.controls.length} controls`);
    }

    // eslint-disable-next-line no-console
    console.log(`\nDone. ${frameworksUpserted} framework(s), ${controlsUpserted} control(s) upserted.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed-compliance] failed:', err);
  process.exit(1);
});
