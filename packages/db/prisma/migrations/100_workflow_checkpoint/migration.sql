-- Sprint 2.5 / A.2 — Postgres-backed LangGraph checkpoint storage.
--
-- Stores both checkpoints (snapshots of the StateGraph state) and pending
-- writes (per-task partial commits before the checkpoint is flushed). The
-- `type` discriminator separates them so a single index covers both reads.
--
-- Tenant isolation is enforced at the SQL layer: every read in
-- PostgresCheckpointSaver scopes by (tenant_id, thread_id). The tenant_id
-- is required on every row because checkpoint contents include user data
-- that must never leak across tenants.

CREATE TABLE "workflow_checkpoints" (
  "id"                    TEXT        NOT NULL,
  "thread_id"             TEXT        NOT NULL,
  "checkpoint_ns"         TEXT        NOT NULL DEFAULT '',
  "checkpoint_id"         TEXT        NOT NULL,
  "parent_checkpoint_id"  TEXT,
  "tenant_id"             TEXT        NOT NULL,
  "type"                  TEXT        NOT NULL,            -- 'checkpoint' | 'write'
  "checkpoint_json"       JSONB,                            -- serialized Checkpoint (null for write rows)
  "metadata_json"         JSONB,                            -- serialized CheckpointMetadata
  "channel_versions_json" JSONB,                            -- ChannelVersions map
  "task_id"               TEXT,                             -- only set for type='write'
  "writes_json"           JSONB,                            -- pending writes payload (only set for type='write')
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workflow_checkpoints_pkey" PRIMARY KEY ("id")
);

-- Uniqueness for checkpoint rows. Write rows can repeat (one per task per checkpoint).
CREATE UNIQUE INDEX "workflow_checkpoints_thread_ns_id_key"
  ON "workflow_checkpoints" ("thread_id", "checkpoint_ns", "checkpoint_id")
  WHERE "type" = 'checkpoint';

-- Tenant + thread scoping; latest-first for getTuple()
CREATE INDEX "workflow_checkpoints_tenant_thread_created_idx"
  ON "workflow_checkpoints" ("tenant_id", "thread_id", "created_at" DESC);

-- Parent traversal for list()
CREATE INDEX "workflow_checkpoints_thread_parent_idx"
  ON "workflow_checkpoints" ("thread_id", "parent_checkpoint_id");

-- Type discriminator for fast separation between checkpoints + writes
CREATE INDEX "workflow_checkpoints_type_thread_idx"
  ON "workflow_checkpoints" ("type", "thread_id");
