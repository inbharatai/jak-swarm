#!/usr/bin/env bash
# ─── JAK Swarm — Verify Google Secret Manager Secrets ──────────────────────
#
# Checks that all required secrets exist in Google Secret Manager with at
# least one enabled version. Does NOT print secret values.
#
# Project:  crafty-haiku-498807-v8
# Region:   asia-south1
#
# Usage:
#   chmod +x scripts/verify-gcp-secrets.sh
#   ./scripts/verify-gcp-secrets.sh

set -euo pipefail

PROJECT_ID="crafty-haiku-498807-v8"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "═══════════════════════════════════════════════════════════════"
echo "  JAK Swarm — Secret Manager Verification"
echo "  Project: ${PROJECT_ID}"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Required secrets for API (12)
API_SECRETS=(
  "DATABASE_URL"
  "DIRECT_URL"
  "AUTH_SECRET"
  "OPENAI_API_KEY"
  "GEMINI_API_KEY"
  "REDIS_URL"
  "NEXT_PUBLIC_SUPABASE_URL"
  "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  "SUPABASE_SERVICE_ROLE_KEY"
  "EVIDENCE_SIGNING_SECRET"
  "METRICS_TOKEN"
  "CORS_ORIGINS"
)

# Additional secrets only Worker needs (already in API list = shared)
WORKER_SECRETS=(
  "DATABASE_URL"
  "DIRECT_URL"
  "AUTH_SECRET"
  "OPENAI_API_KEY"
  "GEMINI_API_KEY"
  "REDIS_URL"
  "SUPABASE_SERVICE_ROLE_KEY"
  "EVIDENCE_SIGNING_SECRET"
  "METRICS_TOKEN"
)

# Optional secrets
OPTIONAL_SECRETS=(
  "SENTRY_DSN"
  "JAK_FIELD_ENCRYPTION_KEY"
  "GITHUB_PAT"
  "SLACK_SIGNING_SECRET"
  "SLACK_CLIENT_ID"
  "SLACK_CLIENT_SECRET"
  "GMAIL_EMAIL"
  "GMAIL_APP_PASSWORD"
)

PASS=0
FAIL=0
WARN=0

check_secret() {
  local name="$1"
  local required="$2"  # "required" or "optional"

  # Check if secret exists
  if ! gcloud secrets describe "$name" --project="$PROJECT_ID" > /dev/null 2>&1; then
    if [ "$required" = "required" ]; then
      echo -e "  ${RED}✗ ${name} — MISSING (required)${NC}"
      FAIL=$((FAIL + 1))
    else
      echo -e "  ${YELLOW}⊘ ${name} — not set (optional)${NC}"
      WARN=$((WARN + 1))
    fi
    return 1
  fi

  # Check if secret has at least one enabled version
  local versions
  versions=$(gcloud secrets versions list "$name" --project="$PROJECT_ID" --filter="state:ENABLED" --format="value(name)" 2>/dev/null || echo "")

  if [ -z "$versions" ]; then
    if [ "$required" = "required" ]; then
      echo -e "  ${RED}✗ ${name} — EXISTS but no enabled versions (required)${NC}"
      FAIL=$((FAIL + 1))
    else
      echo -e "  ${YELLOW}⊘ ${name} — exists but no enabled versions (optional)${NC}"
      WARN=$((WARN + 1))
    fi
    return 1
  fi

  local version_count
  version_count=$(echo "$versions" | wc -l | tr -d ' ')

  # Check if service account has access
  local sa_email="jak-cloud-run-sa@crafty-haiku-498807-v8.iam.gserviceaccount.com"
  local has_access="no"

  if gcloud secrets get-iam-policy "$name" --project="$PROJECT_ID" 2>/dev/null | grep -q "$sa_email"; then
    has_access="yes"
  fi

  if [ "$has_access" = "yes" ]; then
    echo -e "  ${GREEN}✓ ${name} — ${version_count} version(s), SA has access${NC}"
  else
    echo -e "  ${YELLOW}⚠ ${name} — ${version_count} version(s), SA MISSING access (run: gcloud secrets add-iam-policy-binding ${name} --member=serviceAccount:${sa_email} --role=roles/secretmanager.secretAccessor --project=${PROJECT_ID})${NC}"
    WARN=$((WARN + 1))
  fi

  PASS=$((PASS + 1))
  return 0
}

echo "━━━ API Secrets (12 required) ━━━"
for secret in "${API_SECRETS[@]}"; do
  check_secret "$secret" "required"
done

echo ""
echo "━━━ Worker Secrets (9 required, all shared with API) ━━━"
for secret in "${WORKER_SECRETS[@]}"; do
  # Already checked above, just note it
  echo -e "  ${GREEN}↗ ${secret} — shared with API (checked above)${NC}"
done

echo ""
echo "━━━ Optional Secrets ━━━"
for secret in "${OPTIONAL_SECRETS[@]}"; do
  check_secret "$secret" "optional"
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo -e "  ${GREEN}Passed: ${PASS}${NC}"
echo -e "  ${RED}Failed: ${FAIL}${NC}"
echo -e "  ${YELLOW}Warnings: ${WARN}${NC}"
echo "═══════════════════════════════════════════════════════════════"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}❌ Some required secrets are missing. Run scripts/create-gcp-secrets.sh to create them.${NC}"
  exit 1
else
  echo -e "${GREEN}✅ All required secrets are in place!${NC}"
  echo ""
  echo "Next step: Deploy to Cloud Run"
  echo "  gcloud builds submit --config=cloudbuild-api.yaml --project=${PROJECT_ID}"
  echo "  gcloud builds submit --config=cloudbuild-worker.yaml --project=${PROJECT_ID}"
  exit 0
fi