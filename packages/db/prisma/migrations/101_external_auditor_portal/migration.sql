-- Sprint 2.6 — External Auditor Portal.
--
-- Invite-token-only auth flow:
--   1. Admin (REVIEWER+) creates ExternalAuditorInvite with audit_run_id +
--      auditor email + scopes. The cleartext token is returned ONCE; only
--      the SHA-256 hash is persisted.
--   2. Auditor visits the accept link, presents the cleartext token, and
--      the system verifies it against the hash. On accept, an
--      ExternalAuditorEngagement row is created granting per-audit-run
--      scoped access. The User row's role becomes EXTERNAL_AUDITOR.
--   3. Every action (workpaper view, comment, approve/reject/request-
--      changes) writes an ExternalAuditorAction row for the audit trail.
--
-- Tenant isolation is enforced at the SERVICE layer (every query scopes
-- by tenant_id + audit_run_id). The tables also carry tenant_id columns
-- so a misrouted query at the DB layer cannot leak rows.

-- Invites: created by admin, used by auditor exactly once.
CREATE TABLE "external_auditor_invites" (
  "id"                TEXT        NOT NULL,
  "tenant_id"         TEXT        NOT NULL,
  "audit_run_id"      TEXT        NOT NULL,
  "auditor_email"     TEXT        NOT NULL,
  "auditor_name"      TEXT,
  "token_hash"        TEXT        NOT NULL,  -- SHA-256(cleartext) hex
  "scopes"            TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status"            TEXT        NOT NULL DEFAULT 'PENDING',  -- PENDING | ACCEPTED | REVOKED | EXPIRED
  "created_by"        TEXT        NOT NULL,  -- userId of the admin who created the invite
  "expires_at"        TIMESTAMP(3) NOT NULL,
  "accepted_at"       TIMESTAMP(3),
  "accepted_user_id"  TEXT,
  "revoked_at"        TIMESTAMP(3),
  "revoked_by"        TEXT,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "external_auditor_invites_pkey" PRIMARY KEY ("id")
);

-- Hash uniqueness — defense against accidental collisions
CREATE UNIQUE INDEX "external_auditor_invites_token_hash_key"
  ON "external_auditor_invites" ("token_hash");

CREATE INDEX "external_auditor_invites_tenant_status_idx"
  ON "external_auditor_invites" ("tenant_id", "status");

CREATE INDEX "external_auditor_invites_audit_run_idx"
  ON "external_auditor_invites" ("audit_run_id");

-- Engagements: per-(auditor, audit_run) access grants. One auditor can
-- be invited to multiple audit runs; each invite produces one engagement.
CREATE TABLE "external_auditor_engagements" (
  "id"               TEXT        NOT NULL,
  "tenant_id"        TEXT        NOT NULL,
  "user_id"          TEXT        NOT NULL,        -- the EXTERNAL_AUDITOR User row
  "auditor_email"    TEXT        NOT NULL,
  "audit_run_id"     TEXT        NOT NULL,
  "invite_id"        TEXT        NOT NULL,
  "scopes"           TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "access_granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "access_revoked_at" TIMESTAMP(3),
  "expires_at"       TIMESTAMP(3) NOT NULL,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "external_auditor_engagements_pkey" PRIMARY KEY ("id")
);

-- One engagement per (user, audit_run) — re-inviting the same auditor
-- to the same run updates the existing engagement instead of duplicating.
CREATE UNIQUE INDEX "external_auditor_engagements_user_run_key"
  ON "external_auditor_engagements" ("user_id", "audit_run_id");

CREATE INDEX "external_auditor_engagements_tenant_user_idx"
  ON "external_auditor_engagements" ("tenant_id", "user_id");

CREATE INDEX "external_auditor_engagements_audit_run_idx"
  ON "external_auditor_engagements" ("audit_run_id");

-- Audit trail of every action an external auditor took.
CREATE TABLE "external_auditor_actions" (
  "id"             TEXT        NOT NULL,
  "tenant_id"      TEXT        NOT NULL,
  "user_id"        TEXT        NOT NULL,
  "auditor_email"  TEXT        NOT NULL,
  "audit_run_id"   TEXT        NOT NULL,
  "engagement_id"  TEXT        NOT NULL,
  "object_type"    TEXT        NOT NULL,  -- 'workpaper' | 'evidence' | 'control' | 'final_pack' | 'engagement'
  "object_id"      TEXT,
  "action"         TEXT        NOT NULL,  -- 'view' | 'comment' | 'approve' | 'reject' | 'request_changes' | 'download'
  "comment"        TEXT,
  "metadata"       JSONB,                  -- per-action context (e.g. workpaper status before/after)
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "external_auditor_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_auditor_actions_tenant_run_idx"
  ON "external_auditor_actions" ("tenant_id", "audit_run_id");

CREATE INDEX "external_auditor_actions_engagement_idx"
  ON "external_auditor_actions" ("engagement_id", "created_at" DESC);

CREATE INDEX "external_auditor_actions_user_idx"
  ON "external_auditor_actions" ("user_id", "created_at" DESC);
