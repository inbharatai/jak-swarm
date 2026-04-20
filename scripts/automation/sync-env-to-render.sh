#!/usr/bin/env bash
# sync-env-to-render.sh — bulk-upload env vars to a Render service.
#
# Reads KEY=VALUE lines from STDIN (or a file passed as a filename after
# the service name) and PUTs them to the Render env vars endpoint. Render's
# PUT endpoint is atomic — you send the FULL list of env vars, and Render
# replaces them all. This script preserves existing env vars (pulled via
# GET first), then merges in/overwrites with your local file, then PUTs
# the merged list.
#
# Usage:
#   ./scripts/automation/sync-env-to-render.sh jak-swarm-worker < .env.render-worker
#   ./scripts/automation/sync-env-to-render.sh jak-swarm-api .env.render-api
#   ./scripts/automation/sync-env-to-render.sh jak-swarm-grafana-agent .env.render-grafana-agent
#
# Env vars required:
#   RENDER_API_KEY       Render API Bearer token
#   RENDER_OWNER_ID      Workspace ID (tea-…)
#
# File format (one per line):
#   KEY=VALUE
#   # comments and blank lines are ignored
#   KEY_WITH_EQUALS_IN_VALUE=postgresql://user:pa=ss@host:5432/db
#
# Values are treated as opaque strings — NOT shell-expanded. Leading/trailing
# spaces in VALUE are preserved (they'd go straight to the process env).

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib.sh"

require_cmd curl
require_cmd jq
require_env RENDER_API_KEY
require_env RENDER_OWNER_ID

SERVICE_NAME="${1:-}"
ENV_FILE="${2:-}"

if [ -z "$SERVICE_NAME" ]; then
  die "Usage: $0 <service-name> [<env-file>]"
fi

AUTH="Authorization: Bearer $RENDER_API_KEY"

# ─── Locate the target service by name ─────────────────────────────────────

info "Looking up Render service '$SERVICE_NAME'…"
resp=$(api_call GET "https://api.render.com/v1/services?limit=100&ownerId=$RENDER_OWNER_ID&name=$SERVICE_NAME" "$AUTH") \
  || die "Could not list services"
SERVICE_ID=$(printf '%s' "$resp" | jq -r --arg n "$SERVICE_NAME" '[.[] | .service | select(.name == $n)] | .[0].id // empty')
[ -n "$SERVICE_ID" ] || die "No service named '$SERVICE_NAME' in workspace $RENDER_OWNER_ID. Run provision-render-worker.sh first."
ok "Service '$SERVICE_NAME' → $SERVICE_ID"

# ─── Read local env file into a JSON object ────────────────────────────────

build_local_json() {
  # Reads KEY=VALUE lines from stdin (comments/blank skipped) and emits
  # a JSON object {KEY: VALUE, ...}. VALUE may contain '=' (split on FIRST
  # '=' only).
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
[ "$LOCAL_COUNT" -gt 0 ] || die "No KEY=VALUE pairs parsed from env file. Nothing to sync."
ok "Parsed $LOCAL_COUNT env pairs from local file"

# Print redacted preview (keys only, no values)
info "Keys to upsert:"
printf '%s' "$LOCAL_JSON" | jq -r 'keys[]' | sed 's/^/      /'

# ─── Pull current env from Render ──────────────────────────────────────────

info "Fetching current env vars on service $SERVICE_ID…"
REMOTE_RESP=$(api_call GET "https://api.render.com/v1/services/$SERVICE_ID/env-vars" "$AUTH") \
  || die "Could not fetch current env"

# Render returns array of { envVar: { key, value } } — normalize to {KEY:VALUE}
REMOTE_JSON=$(printf '%s' "$REMOTE_RESP" | jq '[.[] | .envVar | {key, value}] | from_entries')
REMOTE_COUNT=$(printf '%s' "$REMOTE_JSON" | jq 'length')
ok "Fetched $REMOTE_COUNT existing env vars on Render"

# ─── Merge: LOCAL overrides REMOTE ─────────────────────────────────────────

MERGED_JSON=$(jq -n --argjson r "$REMOTE_JSON" --argjson l "$LOCAL_JSON" '$r * $l')
MERGED_COUNT=$(printf '%s' "$MERGED_JSON" | jq 'length')

# Diff summary
added=$(jq -n --argjson r "$REMOTE_JSON" --argjson l "$LOCAL_JSON" '$l | keys - ($r | keys)')
updated=$(jq -n --argjson r "$REMOTE_JSON" --argjson l "$LOCAL_JSON" \
  '[($l | to_entries)[] | select(.key as $k | ($r | has($k)) and ($r[$k] != .value)) | .key]')
unchanged_keys=$(jq -n --argjson r "$REMOTE_JSON" --argjson l "$LOCAL_JSON" \
  '[($l | to_entries)[] | select(.key as $k | ($r | has($k)) and ($r[$k] == .value)) | .key]')

echo ""
info "Sync plan:"
printf "  Added:     %s\n" "$(printf '%s' "$added"     | jq -c . )"
printf "  Updated:   %s\n" "$(printf '%s' "$updated"   | jq -c . )"
printf "  Unchanged: %s\n" "$(printf '%s' "$unchanged_keys" | jq -c . )"
printf "  Preserved: %d vars already on Render not in local file\n" \
  "$(jq -n --argjson r "$REMOTE_JSON" --argjson l "$LOCAL_JSON" '($r | keys - ($l | keys)) | length')"
echo ""

confirm "Apply this sync to $SERVICE_NAME ($SERVICE_ID)?" || exit 2

# ─── PUT merged env back to Render ─────────────────────────────────────────

# Render PUT shape: [{"key":"FOO","value":"bar"}, ...]
PUT_BODY=$(printf '%s' "$MERGED_JSON" | jq '[to_entries[] | {key, value}]')

info "Uploading $MERGED_COUNT env vars…"
resp=$(api_call PUT "https://api.render.com/v1/services/$SERVICE_ID/env-vars" "$AUTH" "$PUT_BODY") \
  || die "PUT env vars failed"
ok "Render accepted env var update — service will redeploy automatically"

# ─── Trigger a deploy (Render may already auto-deploy on env change) ──────

info "Triggering fresh deploy to pick up env changes…"
api_call POST "https://api.render.com/v1/services/$SERVICE_ID/deploys" "$AUTH" '{"clearCache": "do_not_clear"}' \
  >/dev/null || warn "Deploy trigger returned non-2xx (env changes may still apply on next auto-deploy)"

ok "Done. Watch https://dashboard.render.com/web/$SERVICE_ID for the new deploy."
