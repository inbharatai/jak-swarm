#!/usr/bin/env bash
# ─── JAK Swarm — Fix Prisma Connection URL Encoding ─────────────────────────
#
# Reads DATABASE_URL or DIRECT_URL from Google Secret Manager, percent-encodes
# the password component for Prisma compatibility, and writes a new secret
# version if the encoding changed.
#
# NEVER prints the actual secret value to stdout.
#
# If the URL cannot be parsed (e.g., unencoded @ in password broke the parser),
# prints manual instructions for reconstructing the URL from the Supabase dashboard.
#
# Usage:
#   ./scripts/fix-prisma-url-encoding.sh DATABASE_URL
#   ./scripts/fix-prisma-url-encoding.sh DIRECT_URL
#
# Project:  crafty-haiku-498807-v8

set -euo pipefail

PROJECT_ID="crafty-haiku-498807-v8"
SA="jak-cloud-run-sa@crafty-haiku-498807-v8.iam.gserviceaccount.com"
SECRET_NAME="${1:-DATABASE_URL}"

if [[ "$SECRET_NAME" != "DATABASE_URL" && "$SECRET_NAME" != "DIRECT_URL" ]]; then
  echo "Usage: $0 DATABASE_URL|DIRECT_URL"
  exit 1
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Fix Prisma URL Encoding — ${SECRET_NAME}${NC}"
echo -e "${BLUE}  Project: ${PROJECT_ID}${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""

# Read the current secret value and try to fix the encoding
FIXED_URL=$(gcloud secrets versions access latest \
  --secret="$SECRET_NAME" \
  --project="$PROJECT_ID" 2>/dev/null | \
node -e "
  const url = require('fs').readFileSync('/dev/stdin', 'utf8').trim();

  if (!url) {
    console.error('ERROR: Secret is empty');
    process.exit(1);
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    // URL parsing failed — the password likely contains unencoded special
    // characters that broke the parser. We can't fix this automatically.
    // Print instructions for manual reconstruction.
    console.error('PARSE_FAILED');
    process.exit(0);
  }

  const pw = parsed.password;
  const decoded = decodeURIComponent(pw);
  const reEncoded = encodeURIComponent(decoded);

  if (pw === reEncoded) {
    // Already correctly encoded — no change needed
    console.error('NO_CHANGE');
    process.exit(0);
  }

  // Fix the encoding
  parsed.password = reEncoded;
  const fixed = parsed.toString();

  // Verify the fixed URL parses correctly
  try {
    new URL(fixed);
  } catch {
    console.error('FIX_FAILED');
    process.exit(1);
  }

  // Output the fixed URL (piped to gcloud below)
  process.stdout.write(fixed);
" 2>&1)

# Check the result from Node.js
if echo "$FIXED_URL" | grep -q "PARSE_FAILED"; then
  echo -e "${RED}════════════════════════════════════════════════════════════════${NC}"
  echo -e "${RED}  Cannot auto-fix: URL parsing failed${NC}"
  echo -e "${RED}════════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo "The password in ${SECRET_NAME} contains unencoded special characters"
  echo "that prevent the URL from parsing. This usually means the password"
  echo "contains @ or : characters that were not percent-encoded."
  echo ""
  echo -e "${YELLOW}Manual fix required:${NC}"
  echo ""
  echo "1. Go to https://supabase.com/dashboard → your project → Settings → Database"
  echo "2. Find your database password"
  echo "3. URL-encode it using Node.js:"
  echo "   node -e \"console.log(encodeURIComponent('YOUR_RAW_PASSWORD'))\""
  echo ""
  echo "4. Reconstruct the URL:"
  if [[ "$SECRET_NAME" == "DATABASE_URL" ]]; then
    echo "   postgresql://postgres.PROJECT_REF:ENCODED_PW@aws-0-ap-south-1.pooler.supabase.com:6543/postgres"
  else
    echo "   postgresql://postgres.PROJECT_REF:ENCODED_PW@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
  fi
  echo ""
  echo "5. Add the corrected URL to Secret Manager:"
  echo "   echo -n 'CORRECTED_URL' | gcloud secrets versions add ${SECRET_NAME} \\"
  echo "     --data-file=- --project=${PROJECT_ID}"
  echo ""
  exit 1
fi

if echo "$FIXED_URL" | grep -q "NO_CHANGE"; then
  echo -e "${GREEN}✅ ${SECRET_NAME} is already correctly encoded. No changes needed.${NC}"
  exit 0
fi

if echo "$FIXED_URL" | grep -q "FIX_FAILED"; then
  echo -e "${RED}════════════════════════════════════════════════════════════════${NC}"
  echo -e "${RED}  Fix verification failed${NC}"
  echo -e "${RED}════════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo "The re-encoded URL did not parse correctly. Manual fix required."
  echo "Follow the manual instructions printed above."
  exit 1
fi

# FIXED_URL contains the corrected URL — write it as a new secret version
echo ""
echo -e "${YELLOW}Password needed re-encoding. Adding new version of ${SECRET_NAME}...${NC}"
echo -n "$FIXED_URL" | gcloud secrets versions add "$SECRET_NAME" \
  --data-file=- \
  --project="$PROJECT_ID" \
  --quiet

# Grant service account access (in case it was missing)
gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
  --member="serviceAccount:${SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --project="$PROJECT_ID" \
  --quiet > /dev/null 2>&1 || true

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ ${SECRET_NAME} updated successfully!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Cloud Run will pick up the new secret version on next deployment."
echo "Run the following to update the running service:"
echo ""
echo "  gcloud run services update jak-swarm-api \\"
echo "    --region=asia-south1 \\"
echo "    --project=${PROJECT_ID} \\"
echo "    --set-secrets=\"DATABASE_URL=DATABASE_URL:latest,..."