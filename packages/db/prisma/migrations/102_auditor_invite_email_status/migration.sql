-- Final hardening / Gap C — auditor invite email send status fields.
--
-- Tracks whether the invite email was actually sent. Honest statuses:
--   'pending'           — invite created; send not yet attempted
--   'sent'              — email sent successfully
--   'not_configured'    — no email provider configured (admin must copy link manually)
--   'failed'            — provider configured but send threw an error

ALTER TABLE "external_auditor_invites"
  ADD COLUMN "email_status"     TEXT,
  ADD COLUMN "email_sent_at"    TIMESTAMP(3),
  ADD COLUMN "email_error"      TEXT,
  ADD COLUMN "email_provider"   TEXT;
