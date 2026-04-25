-- Sub-control breakdown for compliance controls.
-- E.g. SOC 2 CC6.1 has 11 sub-points (CC6.1.1 ... CC6.1.11).
-- See packages/db/prisma/schema.prisma `ComplianceControl.subControls`.

ALTER TABLE "compliance_controls"
  ADD COLUMN IF NOT EXISTS "subControls" JSONB;
