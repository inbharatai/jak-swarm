#!/usr/bin/env bash
# provision-render-worker.sh — create jak-swarm-worker + jak-swarm-grafana-agent
# private services on Render, using the Render REST API.
#
# Idempotent: if a service with the target name already exists in your
# workspace, the script skips creation and prints its ID.
#
# Env vars required:
#   RENDER_API_KEY       Render API key (Bearer token)
#   RENDER_OWNER_ID      Team/workspace ID (format: tea-xxxxx)
#   JAK_REPO_URL         Full URL to the jak-swarm repo (for Render to clone)
#   JAK_REPO_BRANCH      Branch to deploy (default: main)
#
# Prints the service IDs of both services on success.

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib.sh"

require_cmd curl
require_cmd jq
require_env RENDER_API_KEY
require_env RENDER_OWNER_ID
require_env JAK_REPO_URL

REPO_BRANCH="${JAK_REPO_BRANCH:-main}"
REGION="oregon"
PLAN="starter"

AUTH="Authorization: Bearer $RENDER_API_KEY"

# ─── find_service_by_name — returns service id or empty ────────────────────
find_service_by_name() {
  local name="$1"
  local resp
  resp=$(api_call GET "https://api.render.com/v1/services?limit=100&ownerId=$RENDER_OWNER_ID&name=$name" "$AUTH") || return 1
  # Render returns array of {service: {...}} objects; we match by exact name
  printf '%s' "$resp" | jq -r --arg n "$name" '[.[] | .service | select(.name == $n)] | .[0].id // empty'
}

# ─── create_worker_service ─────────────────────────────────────────────────
create_worker_service() {
  info "Creating Render pserv 'jak-swarm-worker'…"
  local body
  body=$(jq -n \
    --arg ownerId  "$RENDER_OWNER_ID" \
    --arg repo     "$JAK_REPO_URL" \
    --arg branch   "$REPO_BRANCH" \
    --arg region   "$REGION" \
    --arg plan     "$PLAN" \
    '{
      type: "private_service",
      name: "jak-swarm-worker",
      ownerId: $ownerId,
      repo: $repo,
      branch: $branch,
      autoDeploy: "yes",
      serviceDetails: {
        env: "docker",
        region: $region,
        plan: $plan,
        dockerfilePath: "./Dockerfile",
        dockerContext: ".",
        dockerCommand: "node apps/api/dist/worker-entry.js",
        envSpecificDetails: {
          dockerCommand: "node apps/api/dist/worker-entry.js"
        }
      }
    }')

  local resp
  resp=$(api_call POST "https://api.render.com/v1/services" "$AUTH" "$body") || die "Render create worker failed"
  local id
  id=$(printf '%s' "$resp" | jq -r '.service.id // .id // empty')
  [ -n "$id" ] || die "Render responded 2xx but no service id in body: $resp"
  ok "Created jak-swarm-worker → $id"
  printf '%s' "$id"
}

# ─── create_grafana_agent_service ──────────────────────────────────────────
create_grafana_agent_service() {
  info "Creating Render pserv 'jak-swarm-grafana-agent'…"
  local body
  body=$(jq -n \
    --arg ownerId  "$RENDER_OWNER_ID" \
    --arg repo     "$JAK_REPO_URL" \
    --arg branch   "$REPO_BRANCH" \
    --arg region   "$REGION" \
    --arg plan     "$PLAN" \
    '{
      type: "private_service",
      name: "jak-swarm-grafana-agent",
      ownerId: $ownerId,
      repo: $repo,
      branch: $branch,
      autoDeploy: "yes",
      serviceDetails: {
        env: "docker",
        region: $region,
        plan: $plan,
        dockerfilePath: "./ops/grafana-agent/Dockerfile",
        dockerContext: "."
      }
    }')

  local resp
  resp=$(api_call POST "https://api.render.com/v1/services" "$AUTH" "$body") || die "Render create grafana-agent failed"
  local id
  id=$(printf '%s' "$resp" | jq -r '.service.id // .id // empty')
  [ -n "$id" ] || die "Render responded 2xx but no service id in body: $resp"
  ok "Created jak-swarm-grafana-agent → $id"
  printf '%s' "$id"
}

# ─── main ──────────────────────────────────────────────────────────────────

echo "─── Render provisioner ────────────────────────────────────"
info "Owner ID    : $RENDER_OWNER_ID"
info "Repo        : $JAK_REPO_URL"
info "Branch      : $REPO_BRANCH"
info "Region      : $REGION"
info "Plan        : $PLAN"
info "API key     : $(mask_token "$RENDER_API_KEY")"
echo ""

confirm "Provision jak-swarm-worker + jak-swarm-grafana-agent in the above workspace?" || exit 2

# Worker
echo ""
existing=$(find_service_by_name "jak-swarm-worker" || true)
if [ -n "$existing" ]; then
  warn "jak-swarm-worker already exists → $existing (skipping creation)"
  WORKER_ID="$existing"
else
  WORKER_ID=$(create_worker_service)
fi

# Grafana Agent
echo ""
existing=$(find_service_by_name "jak-swarm-grafana-agent" || true)
if [ -n "$existing" ]; then
  warn "jak-swarm-grafana-agent already exists → $existing (skipping creation)"
  AGENT_ID="$existing"
else
  AGENT_ID=$(create_grafana_agent_service)
fi

echo ""
echo "─── Result ────────────────────────────────────────────────"
printf "jak-swarm-worker:         %s\n" "$WORKER_ID"
printf "jak-swarm-grafana-agent:  %s\n" "$AGENT_ID"
echo ""
info "Next step: upload env vars to each service with sync-env-to-render.sh"
info "Example:   ./scripts/automation/sync-env-to-render.sh jak-swarm-worker < .env.render-worker"
