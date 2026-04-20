#!/usr/bin/env bash
# probe-tokens.sh — read-only connectivity check for every platform.
#
# Runs ONE GET per platform to verify your rotated tokens work. No mutation.
# Use before running any provisioning script.
#
# Env vars required (depending on which platforms you want to probe):
#   RENDER_API_KEY           — probes Render (GET /v1/services)
#   SUPABASE_PROJECT_REF     — plus
#   SUPABASE_MANAGEMENT_TOKEN → probes Supabase (GET /v1/projects/:ref)
#   VERCEL_API_TOKEN         — plus
#   VERCEL_PROJECT_ID        → probes Vercel (GET /v9/projects/:id)
#
# Missing env for any platform → that platform is skipped with a notice.

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib.sh"

require_cmd curl
require_cmd jq

any_tested=0
any_failed=0

echo "─── Render ────────────────────────────────────────────────"
if [ -n "${RENDER_API_KEY:-}" ]; then
  any_tested=1
  info "Probing Render with key $(mask_token "$RENDER_API_KEY")"
  resp=$(api_call GET "https://api.render.com/v1/services?limit=1" "Authorization: Bearer $RENDER_API_KEY") && {
    count=$(printf '%s' "$resp" | jq 'length' 2>/dev/null || echo "?")
    ok "Render API reachable — returned $count service(s)"
  } || {
    any_failed=1
    fail "Render probe failed — check RENDER_API_KEY scope"
  }
else
  info "Skipped (RENDER_API_KEY not set)"
fi

echo ""
echo "─── Supabase ──────────────────────────────────────────────"
if [ -n "${SUPABASE_MANAGEMENT_TOKEN:-}" ] && [ -n "${SUPABASE_PROJECT_REF:-}" ]; then
  any_tested=1
  info "Probing Supabase project $SUPABASE_PROJECT_REF with token $(mask_token "$SUPABASE_MANAGEMENT_TOKEN")"
  resp=$(api_call GET "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF" "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN") && {
    name=$(printf '%s' "$resp" | jq -r '.name // "?"' 2>/dev/null)
    region=$(printf '%s' "$resp" | jq -r '.region // "?"' 2>/dev/null)
    ok "Supabase API reachable — project='$name' region='$region'"
  } || {
    any_failed=1
    fail "Supabase probe failed — check SUPABASE_MANAGEMENT_TOKEN or SUPABASE_PROJECT_REF"
  }
else
  info "Skipped (SUPABASE_MANAGEMENT_TOKEN or SUPABASE_PROJECT_REF not set)"
fi

echo ""
echo "─── Vercel ────────────────────────────────────────────────"
if [ -n "${VERCEL_API_TOKEN:-}" ] && [ -n "${VERCEL_PROJECT_ID:-}" ]; then
  any_tested=1
  info "Probing Vercel project $VERCEL_PROJECT_ID with token $(mask_token "$VERCEL_API_TOKEN")"
  resp=$(api_call GET "https://api.vercel.com/v9/projects/$VERCEL_PROJECT_ID" "Authorization: Bearer $VERCEL_API_TOKEN") && {
    name=$(printf '%s' "$resp" | jq -r '.name // "?"' 2>/dev/null)
    framework=$(printf '%s' "$resp" | jq -r '.framework // "?"' 2>/dev/null)
    ok "Vercel API reachable — project='$name' framework='$framework'"
  } || {
    any_failed=1
    fail "Vercel probe failed — check VERCEL_API_TOKEN or VERCEL_PROJECT_ID"
  }
else
  info "Skipped (VERCEL_API_TOKEN or VERCEL_PROJECT_ID not set)"
fi

echo ""
echo "─── Summary ──────────────────────────────────────────────"
if [ "$any_tested" = "0" ]; then
  warn "No platforms probed — you did not set any of the supported env vars."
  warn "See scripts/automation/README.md for the list."
  exit 2
fi

if [ "$any_failed" = "1" ]; then
  fail "One or more probes failed. Fix tokens before running provisioning scripts."
  exit 1
fi

ok "All probed platforms reachable. You can now run the provisioning scripts safely."
