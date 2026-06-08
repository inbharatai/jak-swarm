#!/usr/bin/env bash
# ─── JAK Swarm — Verify Prisma Connection URL Encoding ─────────────────────
#
# Reads DATABASE_URL or DIRECT_URL from Google Secret Manager and validates
# that the password component is correctly percent-encoded for Prisma.
#
# NEVER prints the actual secret value — only the hostname, port, and
# pass/fail status.
#
# Usage:
#   ./scripts/verify-prisma-url.sh DATABASE_URL
#   ./scripts/verify-prisma-url.sh DIRECT_URL
#
# Exit codes:
#   0 — URL is correctly encoded
#   1 — URL needs encoding or can't be parsed

set -euo pipefail

PROJECT_ID="crafty-haiku-498807-v8"
SECRET_NAME="${1:-DATABASE_URL}"

if [[ "$SECRET_NAME" != "DATABASE_URL" && "$SECRET_NAME" != "DIRECT_URL" ]]; then
  echo "Usage: $0 DATABASE_URL|DIRECT_URL"
  exit 1
fi

echo "Verifying $SECRET_NAME encoding..."

RESULT=$(gcloud secrets versions access latest \
  --secret="$SECRET_NAME" \
  --project="$PROJECT_ID" 2>/dev/null | \
node -e "
  const url = require('fs').readFileSync('/dev/stdin', 'utf8').trim();

  if (!url) {
    console.log('FAIL: Secret is empty');
    process.exit(1);
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    console.log('FAIL: URL cannot be parsed — password likely contains unencoded special characters (@, :, /, #)');
    console.log('  Error:', e.message);
    console.log('  Action: Manually reconstruct the URL from the Supabase dashboard with encodeURIComponent()');
    process.exit(1);
  }

  const pw = parsed.password;
  const decoded = decodeURIComponent(pw);
  const reEncoded = encodeURIComponent(decoded);

  // Check protocol
  if (!url.startsWith('postgresql://')) {
    console.log('FAIL: URL must start with postgresql:// (got: ' + url.substring(0, 20) + '...)');
    process.exit(1);
  }

  // Check for .railway.internal (should never be in a DB URL)
  if (parsed.hostname.includes('.railway.internal')) {
    console.log('FAIL: Hostname is .railway.internal — this is a Railway private DNS that Cloud Run cannot reach');
    process.exit(1);
  }

  // Check for Supabase pooler format (port 6543 for DATABASE_URL, 5432 for DIRECT_URL)
  const expectedPort = SECRET_NAME === 'DATABASE_URL' ? '6543' : '5432';
  if (parsed.port !== expectedPort && parsed.port !== '5432') {
    console.log('WARN: Expected port ' + expectedPort + ' but got port ' + parsed.port);
  }

  if (pw === reEncoded) {
    console.log('PASS: Password in $SECRET_NAME is correctly percent-encoded for Prisma');
    console.log('  Host:', parsed.hostname);
    console.log('  Port:', parsed.port);
    console.log('  User:', parsed.username);
    console.log('  Database:', parsed.pathname.replace(/^\\//, ''));
    console.log('  Password length:', pw.length, 'chars');
  } else {
    console.log('FAIL: Password in $SECRET_NAME needs re-encoding');
    console.log('  Current encoding does not match encodeURIComponent() output');
    console.log('  Run: ./scripts/fix-prisma-url-encoding.sh $SECRET_NAME');
    process.exit(1);
  }
" 2>&1)

echo "$RESULT"

# Check if the result contains FAIL
if echo "$RESULT" | grep -q "FAIL"; then
  exit 1
fi

exit 0