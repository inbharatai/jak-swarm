-- Migration 125 — Multiplayer collaboration layer.
--
-- Adds first-class workflow participants and an append-only shared-session event
-- timeline without changing existing workflow/approval semantics. All rows are
-- tenant-scoped and cascade with their parent workflow.

CREATE TABLE IF NOT EXISTS "workflow_participants" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'VIEWER',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activeTaskId" TEXT,
  "controlLeaseUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workflow_participants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_participants_role_check" CHECK ("role" IN ('OWNER', 'EDITOR', 'REVIEWER', 'VIEWER')),
  CONSTRAINT "workflow_participants_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workflow_participants_workflow_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workflow_participants_user_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_participants_workflow_user_key"
  ON "workflow_participants"("workflowId", "userId");
CREATE INDEX IF NOT EXISTS "workflow_participants_tenant_workflow_idx"
  ON "workflow_participants"("tenantId", "workflowId");
CREATE INDEX IF NOT EXISTS "workflow_participants_presence_idx"
  ON "workflow_participants"("workflowId", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "workflow_participants_control_idx"
  ON "workflow_participants"("workflowId", "activeTaskId", "controlLeaseUntil");

CREATE TABLE IF NOT EXISTS "workflow_session_events" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT,
  "eventType" TEXT NOT NULL,
  "taskId" TEXT,
  "content" TEXT,
  "metadata" JSONB,
  "sequence" BIGSERIAL NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workflow_session_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_session_events_actor_type_check" CHECK ("actorType" IN ('HUMAN', 'AGENT', 'SYSTEM')),
  CONSTRAINT "workflow_session_events_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workflow_session_events_workflow_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_session_events_sequence_key"
  ON "workflow_session_events"("sequence");
CREATE INDEX IF NOT EXISTS "workflow_session_events_workflow_sequence_idx"
  ON "workflow_session_events"("workflowId", "sequence");
CREATE INDEX IF NOT EXISTS "workflow_session_events_tenant_created_idx"
  ON "workflow_session_events"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "workflow_session_events_workflow_task_idx"
  ON "workflow_session_events"("workflowId", "taskId");
