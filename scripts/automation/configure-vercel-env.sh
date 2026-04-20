#!/usr/bin/env bash
# configure-vercel-env.sh — bulk-upload Vercel project env vars for production.
#
# Reads KEY=VALUE lines from STDIN (or a filename arg) and POSTs each to
# the Vercel v10 env API. Existing keys are overwritten. Scoped to
# "production" target (set TARGET=preview or development to override).
#
# Safety: this script REFUSES to upload any key that does NOT start with
# NEXT_PUBLIC_ — because Vercel env vars intended for the browser bundle
# should be namespaced NEXT_PUBLIC_*. If you need a server-side-only env
# (e.g. an SSR secret that lives on Vercel edge), override with
# ALLOW_SERVER_ONLY=1 — and understand the security tradeoff.
#
# Env vars required:
#   VERCEL_API_TOKEN       from vercel.com/account/tokens
#   VERCEL_PROJECT_ID      prj_… — Project Settings → General
#
# Optional:
#   VERCEL_TEAM_ID         for team-scoped projects (starts with team_…)
#   TARGET                 production | preview | development (default production)
#   ALLOW_SERVER_ONLY      1 to permit non-NEXT_PUBLIC_* keys
#
# Usage:
#   ./scripts/automation/configure-vercel-env.sh < .env.vercel-production
#   ./scripts/automation/configure-vercel-env.sh .env.vercel-production

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib.sh"

require_cmd curl
require_cmd jq
require_env VERCEL_API_TOKEN
require_env VERCEL_PROJECT_ID

TARGET="${TARGET:-production}"
ENV_FILE="${1:-}"
ALLOW_SERVER_ONLY="${ALLOW_SERVER_ONLY:-0}"

AUTH="Authorization: Bearer $VERCEL_API_TOKEN"
TEAM_QS=""
if [ -n "${VERCEL_TEAM_ID:-}" ]; then
  TEAM_QS="?teamId=$VERCEL_TEAM_ID"
fi

# ─── Parse env file ────────────────────────────────────────────────────────

build_local_json() {
  jq -Rs 'split("\n")
    | map(select(length > 0 and (startswith("#") | not)))
    | map(split("=") as $parts
        | if ($parts | length) < 2 then empty
          else { key: $parts[0], value: ($parts[1:] | join("=")) }
          end)
    | from_entries'
}

info "Reading env file…"
if [ -n "$ENV_FILE" ]; then
  [ -f "$ENV_FILE" ] || die "Env file not found: $ENV_FILE"
  LOCAL_JSON=$(build_local_json < "$ENV_FILE")
else
  LOCAL_JSON=$(build_local_json)
fi

LOCAL_COUNT=$(printf '%s' "$LOCAL_JSON" | jq 'length')
[ "$LOCAL_COUNT" -gt 0 ] || die "No KEY=VALUE pairs parsed from env file."

# Safety check: every key must start with NEXT_PUBLIC_ unless override set
non_public_keys=$(printf '%s' "$LOCAL_JSON" | jq -r 'keys[] | select(startswith("NEXT_PUBLIC_") | not)')
if [ -n "$non_public_keys" ] && [ "$ALLOW_SERVER_ONLY" != "1" ]; then
  echo ""
  fail "Refusing to upload the following non-NEXT_PUBLIC_ keys to Vercel:"
  printf '%s\n' "$non_public_keys" | sed 's/^/      /'
  echo ""
  fail "These look like server-side secrets. Vercel env vars for the browser"
  fail "bundle must be NEXT_PUBLIC_ prefixed. If you genuinely need a"
  fail "server-only env on Vercel (SSR secret), re-run with ALLOW_SERVER_ONLY=1."
  exit 3
fi

echo "─── Vercel env sync ───────────────────────────────────────"
info "Project ID : $VERCEL_PROJECT_ID"
info "Team ID    : ${VERCEL_TEAM_ID:-<user scope>}"
info "Target     : $TARGET"
info "Token      : $(mask_token "$VERCEL_API_TOKEN")"
info "Keys to upsert ($LOCAL_COUNT):"
printf '%s' "$LOCAL_JSON" | jq -r 'keys[]' | sed 's/^/      /'
echo ""

confirm "Apply these env vars to Vercel project $VERCEL_PROJECT_ID ($TARGET)?" || exit 2

# ─── Upsert each key ───────────────────────────────────────────────────────
# Vercel's POST /v10/projects/:id/env creates a new env. If a key already
# exists for the same target, it returns 409 Conflict. To overwrite, we
# first DELETE any existing env for that key+target, then re-create.

BASE_URL="https://api.vercel.com/v10/projects/$VERCEL_PROJECT_ID/env"

# Fetch existing envs (returns { envs: [{ id, key, target: [...] }, ...] })
info "Fetching existing Vercel envs…"
resp=$(api_call GET "${BASE_URL}${TEAM_QS}" "$AUTH") || die "Could not fetch envs"
EXISTING=$(printf '%s' "$resp" | jq --arg t "$TARGET" '.envs | map(select(.target | index($t)))')
EX_COUNT=$(printf '%s' "$EXISTING" | jq 'length')
info "Found $EX_COUNT existing env vars for target=$TARGET"

# For each KEY in LOCAL_JSON: delete existing (if any) then create
keys=$(printf '%s' "$LOCAL_JSON" | jq -r 'keys[]')
while IFS= read -r key; do
  [ -n "$key" ] || continue
  value=$(printf '%s' "$LOCAL_JSON" | jq -r --arg k "$key" '.[$k]')

  # Delete existing env for this key+target, if any
  existing_id=$(printf '%s' "$EXISTING" | jq -r --arg k "$key" '[.[] | select(.key == $k) | .id] | .[0] // empty')
  if [ -n "$existing_id" ]; then
    info "Deleting existing env for $key (id=$existing_id)…"
    api_call DELETE "${BASE_URL}/${existing_id}${TEAM_QS}" "$AUTH" >/dev/null \
      || warn "DELETE failed for $key — attempting CREATE anyway"
  fi

  # Create fresh
  body=$(jq -n \
    --arg key "$key" \
    --arg value "$value" \
    --arg target "$TARGET" \
    '{
      key: $key,
      value: $value,
      target: [$target],
      type: "plain"
    }')

  info "Upserting $key…"
  api_call POST "${BASE_URL}${TEAM_QS}" "$AUTH" "$body" >/dev/null \
    || warn "Failed to create $key — skipping"
done <<< "$keys"

ok "Done. Redeploy from Vercel dashboard or push a commit to pick up new envs."
