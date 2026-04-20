#!/usr/bin/env bash
# configure-supabase-redirects.sh — set Supabase Auth Site URL + Redirect URLs
# via the Supabase Management API.
#
# Idempotently PATCHes your project's auth config with the committed list of
# redirect URLs JAK needs (localhost + jakswarm.com + www.jakswarm.com for
# both /auth/callback and /auth/confirm).
#
# If you want to add extra URLs (custom domain, staging), set
# EXTRA_REDIRECT_URLS as a comma-separated list:
#   EXTRA_REDIRECT_URLS="https://staging.jakswarm.com/auth/callback,https://staging.jakswarm.com/auth/confirm"
#
# Env vars required:
#   SUPABASE_PROJECT_REF          e.g. abcdefghijklmnop
#   SUPABASE_MANAGEMENT_TOKEN     supabase.com/dashboard/account/tokens → "Generate new token"
#
# Optional:
#   SUPABASE_SITE_URL             default https://jakswarm.com
#   EXTRA_REDIRECT_URLS           comma-separated additional URIs

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib.sh"

require_cmd curl
require_cmd jq
require_env SUPABASE_PROJECT_REF
require_env SUPABASE_MANAGEMENT_TOKEN

SITE_URL="${SUPABASE_SITE_URL:-https://jakswarm.com}"
AUTH="Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN"

# Default list — matches what JAK's frontend uses (see apps/web/src/lib/auth.ts)
DEFAULT_URLS=(
  "https://jakswarm.com/auth/callback"
  "https://jakswarm.com/auth/confirm"
  "https://www.jakswarm.com/auth/callback"
  "https://www.jakswarm.com/auth/confirm"
  "http://localhost:3000/auth/callback"
  "http://localhost:3000/auth/confirm"
)

# Merge extras
ALL_URLS=("${DEFAULT_URLS[@]}")
if [ -n "${EXTRA_REDIRECT_URLS:-}" ]; then
  IFS=',' read -r -a extras <<< "$EXTRA_REDIRECT_URLS"
  for u in "${extras[@]}"; do
    trimmed=$(printf '%s' "$u" | awk '{$1=$1};1')  # trim whitespace
    [ -n "$trimmed" ] && ALL_URLS+=("$trimmed")
  done
fi

# Build the JSON array (jq handles escaping)
URI_JSON=$(printf '%s\n' "${ALL_URLS[@]}" | jq -R . | jq -s .)

echo "─── Supabase redirect-URL config ──────────────────────────"
info "Project ref: $SUPABASE_PROJECT_REF"
info "Token      : $(mask_token "$SUPABASE_MANAGEMENT_TOKEN")"
info "Site URL   : $SITE_URL"
info "Redirect URLs (${#ALL_URLS[@]}):"
printf '%s\n' "${ALL_URLS[@]}" | sed 's/^/      /'

echo ""
confirm "Apply this auth config to Supabase project $SUPABASE_PROJECT_REF?" || exit 2

# Supabase Management API endpoint (v1):
#   PATCH /v1/projects/:ref/config/auth
# Body:
#   { "site_url": "...", "uri_allow_list": "comma-separated string" }
#
# NOTE: as of 2026, Supabase's uri_allow_list is a SINGLE string of
# comma-separated URIs (not an array). Annoying but stable.

URI_CSV=$(printf '%s' "$URI_JSON" | jq -r 'join(",")')

PATCH_BODY=$(jq -n --arg site "$SITE_URL" --arg uris "$URI_CSV" \
  '{ site_url: $site, uri_allow_list: $uris }')

info "Applying PATCH /v1/projects/$SUPABASE_PROJECT_REF/config/auth …"
resp=$(api_call PATCH \
  "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth" \
  "$AUTH" \
  "$PATCH_BODY") \
  || die "Supabase auth config PATCH failed"

ok "Supabase auth config updated"

# Verify by reading back
info "Verifying…"
GET_RESP=$(api_call GET "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth" "$AUTH") \
  || warn "Could not verify (GET failed, but PATCH reported success)"
if [ -n "$GET_RESP" ]; then
  saved_site=$(printf '%s' "$GET_RESP" | jq -r '.site_url // ""')
  saved_uris=$(printf '%s' "$GET_RESP" | jq -r '.uri_allow_list // ""')
  if [ "$saved_site" = "$SITE_URL" ]; then
    ok "site_url confirmed"
  else
    warn "site_url mismatch — expected '$SITE_URL', got '$saved_site'"
  fi
  # Count URIs
  saved_count=$(printf '%s' "$saved_uris" | tr ',' '\n' | grep -c .)
  info "uri_allow_list now contains $saved_count entries"
fi

ok "Done. Test by running a magic-pin login from your live Vercel site."
