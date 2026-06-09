#!/usr/bin/env bash
# ─── JAK Swarm — Fix Cloud Run API 503 ─────────────────────────────────────
#
# One-shot script to fix DATABASE_URL encoding and REDIS_URL, then redeploy.
# Run this in Google Cloud Shell after authenticating with:
#   gcloud auth login
#   gcloud config set project crafty-haiku-498807-v8
#
# This script:
#   1. Fixes DATABASE_URL percent-encoding for Prisma
#   2. Fixes DIRECT_URL percent-encoding for Prisma
#   3. Updates REDIS_URL with the Railway public URL (prompts you)
#   4. Redeploys Cloud Run API to pick up new secret versions
#   5. Waits for deployment and verifies /healthz + /ready
#
# NEVER prints or logs actual secret values.

set -euo pipefail

PROJECT_ID="crafty-haiku-498807-v8"
REGION="asia-south1"
SERVICE="jak-swarm-api"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  JAK Swarm — Fix Cloud Run API 503${NC}"
echo -e "${BLUE}  Project: ${PROJECT_ID} | Region: ${REGION}${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""

# ─── Step 1: Fix DATABASE_URL encoding ─────────────────────────────────────
echo -e "${YELLOW}━━━ Step 1: Fix DATABASE_URL encoding ━━━${NC}"

chmod +x scripts/verify-prisma-url.sh scripts/fix-prisma-url-encoding.sh 2>/dev/null || true

DB_STATUS=$(./scripts/verify-prisma-url.sh DATABASE_URL 2>&1 || true)
if echo "$DB_STATUS" | grep -q "PASS"; then
  echo -e "${GREEN}  ✅ DATABASE_URL is correctly encoded${NC}"
else
  echo -e "${YELLOW}  DATABASE_URL needs fixing...${NC}"
  ./scripts/fix-prisma-url-encoding.sh DATABASE_URL || {
    echo -e "${RED}  ⚠️  Auto-fix failed. Manual fix required.${NC}"
    echo ""
    echo "  1. Go to https://supabase.com/dashboard → your project → Settings → Database"
    echo "  2. Copy the database password"
    echo "  3. Encode it:"
    echo "     node -e \"console.log(encodeURIComponent('YOUR_RAW_PASSWORD'))\""
    echo ""
    echo "  4. Reconstruct DATABASE_URL (pooler, port 6543):"
    echo '     ENCODED_PW=$(node -e "console.log(encodeURIComponent('"'"'YOUR_RAW_PASSWORD'"'"'))")'
    echo "     echo -n \"postgresql://postgres.PROJECT_REF:\${ENCODED_PW}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres\" | \\"
    echo "       gcloud secrets versions add DATABASE_URL --data-file=- --project=${PROJECT_ID}"
    echo ""
    echo "  After fixing manually, re-run this script."
    exit 1
  }
fi

echo ""

# ─── Step 2: Fix DIRECT_URL encoding ──────────────────────────────────────
echo -e "${YELLOW}━━━ Step 2: Fix DIRECT_URL encoding ━━━${NC}"

DIRECT_STATUS=$(./scripts/verify-prisma-url.sh DIRECT_URL 2>&1 || true)
if echo "$DIRECT_STATUS" | grep -q "PASS"; then
  echo -e "${GREEN}  ✅ DIRECT_URL is correctly encoded${NC}"
else
  echo -e "${YELLOW}  DIRECT_URL needs fixing...${NC}"
  ./scripts/fix-prisma-url-encoding.sh DIRECT_URL || {
    echo -e "${RED}  ⚠️  Auto-fix failed. Manual fix required.${NC}"
    echo ""
    echo "  Same process as DATABASE_URL but with port 5432:"
    echo '     ENCODED_PW=$(node -e "console.log(encodeURIComponent('"'"'YOUR_RAW_PASSWORD'"'"'))")'
    echo "     echo -n \"postgresql://postgres.PROJECT_REF:\${ENCODED_PW}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres\" | \\"
    echo "       gcloud secrets versions add DIRECT_URL --data-file=- --project=${PROJECT_ID}"
    echo ""
    echo "  After fixing manually, re-run this script."
    exit 1
  }
fi

echo ""

# ─── Step 3: Fix REDIS_URL ────────────────────────────────────────────────
echo -e "${YELLOW}━━━ Step 3: Fix REDIS_URL (public endpoint) ━━━${NC}"
echo ""
echo "  The current REDIS_URL likely uses *.railway.internal which Cloud Run"
echo "  cannot reach. You need to paste the PUBLIC Redis URL from Railway."
echo ""
echo "  Go to: https://railway.app → your project → Redis service → Variables"
echo "  Click the eye icon next to REDIS_PUBLIC_URL and copy the value."
echo ""
read -s -p "  Paste REDIS_PUBLIC_URL (hidden): " PUBLIC_REDIS_URL
echo ""

if [ -z "$PUBLIC_REDIS_URL" ]; then
  echo -e "${RED}  ✗ No URL provided — skipping REDIS_URL update${NC}"
  echo -e "${YELLOW}  The API may start in degraded mode (in-memory Redis shim)${NC}"
else
  # Validate it starts with rediss://
  if [[ "$PUBLIC_REDIS_URL" != rediss://* && "$PUBLIC_REDIS_URL" != redis://* ]]; then
    echo -e "${RED}  ✗ URL doesn't look like a Redis URL (expected redis:// or rediss://)${NC}"
    echo -e "${YELLOW}  Got: ${PUBLIC_REDIS_URL:0:20}...${NC}"
    exit 1
  fi

  # Check it's not a .railway.internal hostname
  if echo "$PUBLIC_REDIS_URL" | grep -q '.railway.internal'; then
    echo -e "${RED}  ✗ This is a Railway INTERNAL URL — Cloud Run cannot reach it!${NC}"
    echo -e "${YELLOW}  You need the REDIS_PUBLIC_URL (not REDIS_URL) from Railway.${NC}"
    exit 1
  fi

  echo -n "$PUBLIC_REDIS_URL" | gcloud secrets versions add REDIS_URL \
    --data-file=- \
    --project="$PROJECT_ID" \
    --quiet

  echo -e "${GREEN}  ✅ REDIS_URL updated in Secret Manager${NC}"
fi

echo ""

# ─── Step 4: Redeploy Cloud Run API ──────────────────────────────────────
echo -e "${YELLOW}━━━ Step 4: Redeploy Cloud Run API ━━━${NC}"
echo ""
echo "  Updating service to pick up new secret versions..."
echo ""

gcloud run services update "$SERVICE" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --set-secrets="DATABASE_URL=DATABASE_URL:latest,\
AUTH_SECRET=AUTH_SECRET:latest,\
OPENAI_API_KEY=OPENAI_API_KEY:latest,\
GEMINI_API_KEY=GEMINI_API_KEY:latest,\
REDIS_URL=REDIS_URL:latest,\
DIRECT_URL=DIRECT_URL:latest,\
NEXT_PUBLIC_SUPABASE_URL=NEXT_PUBLIC_SUPABASE_URL:latest,\
NEXT_PUBLIC_SUPABASE_ANON_KEY=NEXT_PUBLIC_SUPABASE_ANON_KEY:latest,\
SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,\
EVIDENCE_SIGNING_SECRET=EVIDENCE_SIGNING_SECRET:latest,\
METRICS_TOKEN=METRICS_TOKEN:latest,\
CORS_ORIGINS=CORS_ORIGINS:latest"

echo ""
echo -e "${GREEN}  ✅ Cloud Run service updated${NC}"

# ─── Step 5: Verify health ────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}━━━ Step 5: Verify health endpoints ━━━${NC}"
echo ""
echo "  Waiting 15 seconds for new revision to start..."
sleep 15

API_URL=$(gcloud run services describe "$SERVICE" \
  --region="$REGION" \
  --format='value(status.url)' \
  --project="$PROJECT_ID")

echo "  API URL: $API_URL"
echo ""

echo -e "${BLUE}  Testing /healthz (liveness)...${NC}"
HEALTHZ=$(curl -s "$API_URL/healthz" 2>&1 || echo "CURL_FAILED")
echo "  $HEALTHZ"
echo ""

echo -e "${BLUE}  Testing /ready (readiness)...${NC}"
READY=$(curl -s "$API_URL/ready" 2>&1 || echo "CURL_FAILED")
echo "  $READY"
echo ""

echo -e "${BLUE}  Testing /health (deep check)...${NC}"
HEALTH=$(curl -s "$API_URL/health" 2>&1 || echo "CURL_FAILED")
echo "  $HEALTH"
echo ""

# ─── Summary ──────────────────────────────────────────────────────────────
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Summary${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"

if echo "$HEALTHZ" | grep -q '"alive"'; then
  echo -e "${GREEN}  ✅ /healthz — alive${NC}"
else
  echo -e "${RED}  ❌ /healthz — not responding (may need more time)${NC}"
fi

if echo "$READY" | grep -q '"ready"'; then
  echo -e "${GREEN}  ✅ /ready — all checks passing${NC}"
elif echo "$READY" | grep -q '"degraded"'; then
  echo -e "${YELLOW}  ⚠️  /ready — degraded (some checks failing)${NC}"
  echo -e "${YELLOW}  Check logs: gcloud run logs read $SERVICE --region=$REGION --project=$PROJECT_ID --limit=30${NC}"
else
  echo -e "${RED}  ❌ /ready — not ready${NC}"
  echo -e "${YELLOW}  Check logs: gcloud run logs read $SERVICE --region=$REGION --project=$PROJECT_ID --limit=30${NC}"
fi

echo ""
echo "  API URL: $API_URL"
echo "  Healthz: $API_URL/healthz"
echo "  Ready:   $API_URL/ready"
echo "  Health:  $API_URL/health"
echo ""
echo -e "${YELLOW}  Next steps:${NC}"
echo "  1. If all endpoints return 200 → Worker deployment can proceed"
echo "  2. If /ready shows degraded → check Cloud Run logs for details"
echo "  3. Do NOT update Vercel NEXT_PUBLIC_API_URL until health is clean"