-- OAuthState: short-lived row holding the PKCE code_verifier + CSRF state
-- token for an in-flight OAuth authorization redirect. The callback route
-- looks up by `state` (unique), validates ownership + expiresAt, reads the
-- code_verifier once, and deletes the row. TTL is enforced by the callback;
-- rows with expiresAt < now() are swept lazily.

CREATE TABLE "oauth_states" (
  "id"           TEXT       NOT NULL,
  "tenantId"     TEXT       NOT NULL,
  "userId"       TEXT       NOT NULL,
  "provider"     TEXT       NOT NULL,
  "state"        TEXT       NOT NULL,
  "codeVerifier" TEXT       NOT NULL,
  "redirectUri"  TEXT       NOT NULL,
  "scopes"       TEXT[]     NOT NULL DEFAULT ARRAY[]::TEXT[],
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_states_state_key" ON "oauth_states"("state");
CREATE INDEX "oauth_states_tenantId_idx" ON "oauth_states"("tenantId");
CREATE INDEX "oauth_states_expiresAt_idx" ON "oauth_states"("expiresAt");

ALTER TABLE "oauth_states"
  ADD CONSTRAINT "oauth_states_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
