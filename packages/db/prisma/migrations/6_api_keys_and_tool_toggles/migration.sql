-- Add disabledToolNames column to tenants for per-tool toggle support
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "disabledToolNames" TEXT[] NOT NULL DEFAULT '{}';
