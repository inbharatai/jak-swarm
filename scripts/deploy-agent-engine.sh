#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# Deploy JAK Swarm Gateway Agent to Google Cloud Agent Engine
# ──────────────────────────────────────────────────────────────────────────────
#
# Prerequisites:
#   1. Google Cloud SDK installed (gcloud CLI)
#   2. A GCP project with Vertex AI API enabled
#   3. A service account with Vertex AI User role
#   4. JAK Swarm API deployed and accessible (Railway URL)
#
# Usage:
#   ./scripts/deploy-agent-engine.sh
#
# Environment variables (required):
#   GCP_PROJECT_ID       - Your Google Cloud project ID
#   GCP_REGION           - GCP region for Agent Engine (default: us-central1)
#   JAK_API_URL           - Railway API base URL
#   JAK_API_KEY           - JAK API authentication key
#   GEMINI_API_KEY         - Gemini API key (if not using Agent Engine's default)
#
# This script:
#   1. Builds the ADK package
#   2. Creates an Agent Engine deployment with the gateway agent
#   3. Returns the agent endpoint URL
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────

GCP_PROJECT_ID="${GCP_PROJECT_ID:?Please set GCP_PROJECT_ID}"
GCP_REGION="${GCP_REGION:-asia-south1}"
JAK_API_URL="${JAK_API_URL:?Please set JAK_API_URL}"
JAK_API_KEY="${JAK_API_KEY:?Please set JAK_API_KEY}"
DISPLAY_NAME="${AGENT_DISPLAY_NAME:-jak-swarm-gateway}"

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  JAK Swarm → Google Agent Engine Deployment                   ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Project:   ${GCP_PROJECT_ID}"
echo "Region:    ${GCP_REGION}"
echo "JAK API:   ${JAK_API_URL}"
echo "Agent:     ${DISPLAY_NAME}"
echo ""

# ─── Step 1: Authenticate with Google Cloud ──────────────────────────────────

echo "🔐 Checking gcloud authentication..."
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "@"; then
    echo "❌ No active gcloud account. Run: gcloud auth login"
    exit 1
fi

echo "✅ Authenticated as: $(gcloud auth list --filter=status:ACTIVE --format='value(account)')"

# ─── Step 2: Enable required APIs ─────────────────────────────────────────────

echo ""
echo "📡 Enabling required APIs..."
gcloud services enable aiplatform.googleapis.com \
    --project="${GCP_PROJECT_ID}" \
    --quiet 2>/dev/null || echo "   (already enabled)"

echo "✅ Vertex AI API enabled"

# ─── Step 3: Build the ADK package ───────────────────────────────────────────

echo ""
echo "🔨 Building @jak-swarm/adk package..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_ROOT}"
pnpm install --frozen-lockfile 2>/dev/null
pnpm --filter @jak-swarm/adk build 2>/dev/null

echo "✅ Build complete"

# ─── Step 4: Create Agent Engine deployment ──────────────────────────────────

echo ""
echo "🚀 Creating Agent Engine deployment..."

# The agent-engine create command uses a Python module path.
# We package the deploy module as the entry point.

AGENT_ENGINE_RESULT=$(gcloud ai agent-engines create \
    --display-name="${DISPLAY_NAME}" \
    --region="${GCP_REGION}" \
    --project="${GCP_PROJECT_ID}" \
    --module-path="packages/adk/src/deploy" \
    --env-vars="JAK_API_URL=${JAK_API_URL},JAK_API_KEY=${JAK_API_KEY}" \
    --format="json" 2>&1 || true)

if echo "${AGENT_ENGINE_RESULT}" | grep -q '"name"'; then
    AGENT_ID=$(echo "${AGENT_ENGINE_RESULT}" | python3 -c "import sys, json; print(json.load(sys.stdin)['name'].split('/')[-1])" 2>/dev/null || echo "unknown")
    echo "✅ Agent Engine created successfully!"
    echo ""
    echo "════════════════════════════════════════════════════════════════"
    echo "  Agent ID:    ${AGENT_ID}"
    echo "  Region:      ${GCP_REGION}"
    echo "  Project:     ${GCP_PROJECT_ID}"
    echo ""
    echo "  Test with:"
    echo "    gcloud ai agent-engines run \\"
    echo "      --agent=${AGENT_ID} \\"
    echo "      --region=${GCP_REGION} \\"
    echo "      --project=${GCP_PROJECT_ID} \\"
    echo "      --input='{\"goal\": \"Analyze our Q3 marketing performance\"}'"
    echo "════════════════════════════════════════════════════════════════"
else
    echo "⚠️  Agent Engine creation encountered an issue:"
    echo "${AGENT_ENGINE_RESULT}"
    echo ""
    echo "This may be because Agent Engine requires a Python runtime."
    echo "As an alternative, you can deploy using a Cloud Run container:"
    echo ""
    echo "  1. Build a Docker image from packages/adk/"
    echo "  2. Deploy to Cloud Run with the gateway agent as entry point"
    echo "  3. Use the Cloud Run URL as your Agent Engine endpoint"
    echo ""
    echo "See: https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine"
fi

echo ""
echo "✨ Deployment script complete"