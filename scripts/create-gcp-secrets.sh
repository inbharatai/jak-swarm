#!/usr/bin/env bash
# ─── JAK Swarm — Create Google Secret Manager Secrets ──────────────────────
#
# Interactive script to create all required secrets for Cloud Run deployment.
# Uses read -s (silent mode) for secret values so they don't echo to terminal.
# Creates the secret if missing, adds a new version if it already exists.
#
# Project:  crafty-haiku-498807-v8
# Region:   asia-south1
# SA:       jak-cloud-run-sa@crafty-haiku-498807-v8.iam.gserviceaccount.com
#
# Usage:
#   chmod +x scripts/create-gcp-secrets.sh
#   ./scripts/create-gcp-secrets.sh
#
# Prerequisites:
#   - gcloud CLI installed and authenticated (gcloud auth login)
#   - Secret Manager API enabled
#   - You have the secret values ready to paste

set -euo pipefail

PROJECT_ID="crafty-haiku-498807-v8"
REGION="asia-south1"
SA="jak-cloud-run-sa@crafty-haiku-498807-v8.iam.gserviceaccount.com"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  JAK Swarm — Google Secret Manager Setup${NC}"
echo -e "${BLUE}  Project: ${PROJECT_ID}${NC}"
echo -e "${BLUE}  Region:  ${REGION}${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "This script will prompt you for each secret value."
echo "Secret values will NOT be echoed to the terminal."
echo "Press Ctrl+C at any time to abort."
echo ""

# ─── Helper function: create or update a secret ──────────────────────────────
create_or_update_secret() {
  local name="$1"
  local value="$2"
  local desc="$3"

  # Check if secret already exists
  if gcloud secrets describe "$name" --project="$PROJECT_ID" > /dev/null 2>&1; then
    # Secret exists — add a new version
    echo -e "${YELLOW}  Updating existing secret: ${name}${NC}"
    echo -n "$value" | gcloud secrets versions add "$name" \
      --data-file=- \
      --project="$PROJECT_ID" \
      --quiet
    echo -e "${GREEN}  ✓ ${name} — new version added${NC}"
  else
    # Secret doesn't exist — create it
    echo -e "${YELLOW}  Creating secret: ${name}${NC}"
    echo -n "$value" | gcloud secrets create "$name" \
      --data-file=- \
      --replication-policy="automatic" \
      --project="$PROJECT_ID" \
      --quiet
    # Grant the service account access
    gcloud secrets add-iam-policy-binding "$name" \
      --member="serviceAccount:${SA}" \
      --role="roles/secretmanager.secretAccessor" \
      --project="$PROJECT_ID" \
      --quiet > /dev/null 2>&1
    echo -e "${GREEN}  ✓ ${name} — created and access granted${NC}"
  fi
}

# ─── Helper function: prompt for a secret value ──────────────────────────────
prompt_secret() {
  local name="$1"
  local desc="$2"
  local is_secret="$3"  # "yes" or "no"
  local value=""

  echo ""
  echo -e "${BLUE}───────────────────────────────────────────────────────────${NC}"
  echo -e "${BLUE}  Secret: ${name}${NC}"
  echo -e "  ${desc}"
  echo ""

  if [ "$is_secret" = "no" ]; then
    # Non-secret — show what you're typing
    read -p "  Enter value: " value
  else
    # Secret — hide what you're typing
    read -s -p "  Enter value (hidden): " value
    echo ""  # newline after hidden input
  fi

  if [ -z "$value" ]; then
    echo -e "${RED}  ✗ Skipped — no value provided${NC}"
    return 1
  fi

  create_or_update_secret "$name" "$value" "$desc"
  return 0
}

# ─── Helper function: prompt for a non-secret value ──────────────────────────
prompt_non_secret() {
  local name="$1"
  local desc="$2"
  local default="$3"
  local value=""

  echo ""
  echo -e "${BLUE}  Non-secret: ${name}${NC}"
  echo -e "  ${desc}"
  if [ -n "$default" ]; then
    echo -e "  Default: ${default}"
  fi

  read -p "  Enter value [$default]: " value
  if [ -z "$value" ]; then
    value="$default"
  fi

  create_or_update_secret "$name" "$value" "$desc"
  return 0
}

# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}━━━ STEP 1: Required Secrets (from Railway) ━━━${NC}"
echo ""
echo "Log into https://railway.app → JAK Swarm project → jak-swarm-api → Variables"
echo "Click the eye icon to reveal each value, then paste it below."
echo ""

prompt_secret "DATABASE_URL" \
  "Supabase pooler connection string (port 6543). Copy from Railway → jak-swarm-api → DATABASE_URL" \
  "yes" || true

prompt_secret "DIRECT_URL" \
  "Supabase direct connection string (port 5432, for migrations). Copy from Railway → jak-swarm-api → DIRECT_URL" \
  "yes" || true

prompt_secret "AUTH_SECRET" \
  "JWT signing secret (32+ chars). Copy from Railway → jak-swarm-api → AUTH_SECRET" \
  "yes" || true

prompt_secret "OPENAI_API_KEY" \
  "OpenAI API key (starts with sk-...). Copy from Railway → jak-swarm-api → OPENAI_API_KEY" \
  "yes" || true

prompt_secret "REDIS_URL" \
  "Redis connection string (starts with rediss://). Copy from Railway → jak-swarm-worker → REDIS_URL" \
  "yes" || true

prompt_secret "EVIDENCE_SIGNING_SECRET" \
  "HMAC signing secret for audit evidence bundles (16+ chars). Copy from Railway → jak-swarm-api → EVIDENCE_SIGNING_SECRET" \
  "yes" || true

prompt_secret "METRICS_TOKEN" \
  "Bearer token for /metrics endpoint. Copy from Railway → jak-swarm-api → METRICS_TOKEN" \
  "yes" || true

# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}━━━ STEP 2: Required Secrets (from Supabase) ━━━${NC}"
echo ""
echo "Log into https://supabase.com/dashboard → your project → Project Settings → API"
echo ""

prompt_secret "NEXT_PUBLIC_SUPABASE_URL" \
  "Supabase project URL (e.g. https://xxxxx.supabase.co). Copy from Supabase dashboard → API → Project URL" \
  "yes" || true

prompt_secret "NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  "Supabase anon public key (starts with eyJ...). Copy from Supabase dashboard → API → anon public" \
  "yes" || true

prompt_secret "SUPABASE_SERVICE_ROLE_KEY" \
  "Supabase service_role secret key (starts with eyJ...). Copy from Supabase dashboard → API → service_role secret. ⚠️ NEVER expose this to the client!" \
  "yes" || true

# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}━━━ STEP 3: Required Secrets (from Google AI Studio) ━━━${NC}"
echo ""
echo "Go to https://aistudio.google.com/apikey and create an API key for project crafty-haiku-498807-v8"
echo ""

prompt_secret "GEMINI_API_KEY" \
  "Google Gemini API key (starts with AIza...). Create at https://aistudio.google.com/apikey" \
  "yes" || true

# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}━━━ STEP 4: Non-Secret Configuration ━━━${NC}"
echo ""
echo "This value is not sensitive but is stored in Secret Manager for convenience."
echo ""

prompt_non_secret "CORS_ORIGINS" \
  "Comma-separated allowed origins for CORS" \
  "https://jakswarm.com,https://www.jakswarm.com"

# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${YELLOW}━━━ STEP 5: Optional Secrets (press Enter to skip) ━━━${NC}"
echo ""
echo "These are optional and can be set later."
echo ""

prompt_secret "SENTRY_DSN" \
  "Sentry DSN for error tracking (optional — press Enter to skip)" \
  "yes" || true

prompt_secret "JAK_FIELD_ENCRYPTION_KEY" \
  "AES-256-GCM key for PII field encryption, 64 hex chars (optional — press Enter to skip)" \
  "yes" || true

prompt_secret "GITHUB_PAT" \
  "GitHub personal access token for MCP integration (optional — press Enter to skip)" \
  "yes" || true

prompt_secret "SLACK_SIGNING_SECRET" \
  "Slack app signing secret (optional — press Enter to skip)" \
  "yes" || true

prompt_secret "SLACK_CLIENT_ID" \
  "Slack OAuth client ID (optional — press Enter to skip)" \
  "yes" || true

prompt_secret "SLACK_CLIENT_SECRET" \
  "Slack OAuth client secret (optional — press Enter to skip)" \
  "yes" || true

prompt_secret "GMAIL_EMAIL" \
  "Gmail address for IMAP/SMTP (optional — press Enter to skip)" \
  "no" || true

prompt_secret "GMAIL_APP_PASSWORD" \
  "Gmail app-specific password (optional — press Enter to skip)" \
  "yes" || true

# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Secret creation complete!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Next steps:"
echo "  1. Run verification:  ./scripts/verify-gcp-secrets.sh"
echo "  2. Build and deploy: gcloud builds submit --config=cloudbuild-api.yaml ..."
echo "  3. Configure secrets on the Cloud Run service (see docs/GOOGLE_SECRET_MANAGER_SETUP.md)"
echo ""
echo -e "${YELLOW}⚠️  Important: Do NOT commit this script with real secret values!${NC}"
echo -e "${YELLOW}⚠️  This script only stores values in Google Secret Manager, not on disk.${NC}"