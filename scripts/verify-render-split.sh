#!/usr/bin/env bash
# verify-render-split.sh — smoke check for the Render API+Worker split.
#
# Usage (from any machine with network access to your public Render API):
#   JAK_API_URL=https://jak-swarm-api.onrender.com ./scripts/verify-render-split.sh
#
# Usage (from inside the Render shell of any service in the project):
#   JAK_API_URL=http://jak-swarm-api:4000 \
#   JAK_WORKER_URL=http://jak-swarm-worker:9464 \
#     ./scripts/verify-render-split.sh
#
# Exits 0 on all pass, non-zero with the first failure reported.

set -u

JAK_API_URL="${JAK_API_URL:-https://jak-swarm-api.onrender.com}"
JAK_WORKER_URL="${JAK_WORKER_URL:-http://jak-swarm-worker:9464}"

fail_count=0
pass_count=0

pass() { echo "  [PASS] $1"; pass_count=$((pass_count + 1)); }
fail() { echo "  [FAIL] $1"; fail_count=$((fail_count + 1)); }

check_json_field() {
  local url="$1"
  local field="$2"
  local expected="$3"
  local label="$4"

  local body
  body=$(curl -fsS --max-time 10 "$url" 2>/dev/null) || {
    fail "$label — HTTP request failed ($url)"
    return 1
  }

  local actual
  actual=$(printf '%s' "$body" | grep -oE "\"$field\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed -E "s/.*\"$field\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/")
  if [ "$actual" = "$expected" ]; then
    pass "$label ($field=$expected)"
  else
    fail "$label — expected $field=$expected, got '$actual' (body: $(printf '%s' "$body" | head -c 200))"
  fi
}

check_contains() {
  local url="$1"
  local needle="$2"
  local label="$3"

  local body
  body=$(curl -fsS --max-time 10 "$url" 2>/dev/null) || {
    fail "$label — HTTP request failed ($url)"
    return 1
  }

  if printf '%s' "$body" | grep -q -- "$needle"; then
    pass "$label (found '$needle')"
  else
    fail "$label — '$needle' not found (body: $(printf '%s' "$body" | head -c 200))"
  fi
}

echo "─── API ($JAK_API_URL) ────────────────────────────────────"
check_json_field "$JAK_API_URL/healthz" "status" "alive" "API liveness"
check_contains "$JAK_API_URL/metrics" "jak_workflows_total" "API metrics emit jak_* series"
check_contains "$JAK_API_URL/metrics" 'jak_workflow_jobs_queued' "API metrics include queue gauge"

echo ""
echo "─── Worker ($JAK_WORKER_URL) ──────────────────────────────"
echo "(Worker URL only reachable from within the Render private network —"
echo " if this script is run from your laptop, expect 'connection refused'"
echo " for the worker checks. Run from the API's Render shell to test both.)"
echo ""
check_json_field "$JAK_WORKER_URL/healthz" "status" "ok" "Worker liveness"
check_contains "$JAK_WORKER_URL/metrics" "jak_workflow_jobs" "Worker metrics emit queue series"

echo ""
echo "─── Summary ──────────────────────────────────────────────"
echo "  Pass: $pass_count"
echo "  Fail: $fail_count"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
exit 0
