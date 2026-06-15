#!/usr/bin/env npx tsx
/**
 * scripts/deploy-agent-engine.ts
 *
 * Deploy JAK Swarm Gateway Agent to Google Cloud Agent Engine (Vertex AI).
 *
 * This script:
 *   1. Validates required environment variables
 *   2. Builds the @jak-swarm/adk package
 *   3. Deploys using `npx @google/adk deploy agent_engine`
 *   4. Captures the reasoningEngines resource ID
 *   5. Writes the resource ID to agent-engine-resource.ts for programmatic access
 *
 * Prerequisites:
 *   - gcloud CLI installed and authenticated (`gcloud auth login`)
 *   - GCP project with Vertex AI API enabled
 *   - GEMINI_API_KEY, JAK_API_URL, JAK_API_KEY set in environment
 *
 * Environment variables:
 *   GCP_PROJECT_ID   - Google Cloud project ID (required)
 *   GCP_REGION        - GCP region for Agent Engine (default: us-central1)
 *   JAK_API_URL       - JAK Swarm API base URL (required)
 *   JAK_API_KEY       - JAK API authentication key (required)
 *   GEMINI_API_KEY    - Gemini API key (required)
 *   AGENT_DISPLAY_NAME - Display name for the agent (default: jak-swarm-gateway)
 *
 * Usage:
 *   GCP_PROJECT_ID=crafty-haiku-498807-v8 \
 *   JAK_API_URL=https://jak-swarm-api-565531938617.asia-south1.run.app \
 *   JAK_API_KEY=<key> \
 *   GEMINI_API_KEY=<key> \
 *   npx tsx scripts/deploy-agent-engine.ts
 */

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const resourceFilePath = resolve(repoRoot, 'packages/adk/src/deploy/agent-engine-resource.ts');

// ─── Configuration ────────────────────────────────────────────────────────────

const GCP_PROJECT_ID = process.env['GCP_PROJECT_ID'] ?? '';
const GCP_REGION = process.env['GCP_REGION'] ?? 'asia-south1';
const JAK_API_URL = process.env['JAK_API_URL'] ?? '';
const JAK_API_KEY = process.env['JAK_API_KEY'] ?? '';
const GEMINI_API_KEY = process.env['GEMINI_API_KEY'] ?? '';
const DISPLAY_NAME = process.env['AGENT_DISPLAY_NAME'] ?? 'jak-swarm-gateway';

// ─── Validation ──────────────────────────────────────────────────────────────

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function validate(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!GCP_PROJECT_ID) errors.push('GCP_PROJECT_ID is required');
  if (!JAK_API_URL) errors.push('JAK_API_URL is required');
  if (!JAK_API_KEY) errors.push('JAK_API_KEY is required');
  if (!GEMINI_API_KEY) errors.push('GEMINI_API_KEY is required');

  // Check gcloud CLI
  try {
    const gcloudVersion = execSync('gcloud --version --format=json', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    console.log(`  gcloud CLI available: ${gcloudVersion.split('\n')[0]}`);
  } catch {
    errors.push('gcloud CLI is not installed or not in PATH. Install from https://cloud.google.com/sdk/docs/install');
  }

  // Check gcloud auth
  try {
    const activeAccount = execSync('gcloud auth list --filter=status:ACTIVE --format="value(account)"', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (activeAccount && activeAccount.includes('@')) {
      console.log(`  Authenticated as: ${activeAccount}`);
    } else {
      warnings.push('No active gcloud account. Run: gcloud auth login');
    }
  } catch {
    warnings.push('Could not verify gcloud authentication. Run: gcloud auth login');
  }

  // Check if @google/adk deploy is available
  try {
    execSync('npx @google/adk --version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    warnings.push('Could not verify @google/adk CLI version. It will be installed on first deploy.');
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Build ───────────────────────────────────────────────────────────────────

function buildAdkPackage(): void {
  console.log('\n🔨 Building @jak-swarm/adk package...');
  try {
    execSync('pnpm --filter @jak-swarm/adk build', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log('✅ Build complete');
  } catch (err) {
    console.error('❌ Build failed. Run manually: pnpm --filter @jak-swarm/adk build');
    throw err;
  }
}

// ─── Deploy ──────────────────────────────────────────────────────────────────

interface DeployResult {
  success: boolean;
  resourceId?: string;
  region?: string;
  displayName?: string;
  rawOutput?: string;
}

function deployToAgentEngine(): DeployResult {
  console.log('\n🚀 Deploying to Agent Engine...');
  console.log(`  Project:  ${GCP_PROJECT_ID}`);
  console.log(`  Region:   ${GCP_REGION}`);
  console.log(`  JAK API:  ${JAK_API_URL}`);
  console.log(`  Agent:    ${DISPLAY_NAME}`);
  console.log('');

  const envVars = `JAK_API_URL=${JAK_API_URL},JAK_API_KEY=${JAK_API_KEY}${GEMINI_API_KEY ? `,GEMINI_API_KEY=${GEMINI_API_KEY}` : ''}`;

  const deployArgs = [
    '@google/adk', 'deploy', 'agent_engine',
    resolve(repoRoot, 'packages/adk/src/deploy'),
    `--project=${GCP_PROJECT_ID}`,
    `--region=${GCP_REGION}`,
    `--display_name=${DISPLAY_NAME}`,
    `--env_vars=${envVars}`,
  ].join(' ');

  try {
    const output = execSync(`npx ${deployArgs}`, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 600_000, // 10 minute timeout
    });

    console.log(output);

    // Extract the reasoningEngines resource ID from the output
    // Format: projects/{PROJECT}/locations/{REGION}/reasoningEngines/{ID}
    const resourceIdMatch = output.match(/projects\/[\d]+\/locations\/[\w-]+\/reasoningEngines\/[\d]+/);
    if (resourceIdMatch) {
      const resourceId = resourceIdMatch[0];
      console.log(`\n✅ Agent Engine created successfully!`);
      console.log(`  Resource ID: ${resourceId}`);
      return { success: true, resourceId, region: GCP_REGION, displayName: DISPLAY_NAME, rawOutput: output };
    }

    // Try alternate format
    const numberIdMatch = output.match(/reasoningEngines\/(\d+)/);
    if (numberIdMatch) {
      const id = numberIdMatch[1];
      const resourceId = `projects/${GCP_PROJECT_ID}/locations/${GCP_REGION}/reasoningEngines/${id}`;
      console.log(`\n✅ Agent Engine created successfully!`);
      console.log(`  Resource ID: ${resourceId}`);
      return { success: true, resourceId, region: GCP_REGION, displayName: DISPLAY_NAME, rawOutput: output };
    }

    console.log('\n⚠️  Deployment output received but could not parse resource ID.');
    console.log('    Check the output above for the reasoningEngines resource ID.');
    return { success: true, rawOutput: output };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('\n❌ Agent Engine deployment failed:');
    console.error(`   ${error.message}`);

    // Suggest Cloud Run fallback
    console.log('\n💡 Fallback: Deploy to Cloud Run instead:');
    console.log('   npx @google/adk deploy cloud_run packages/adk/src/deploy \\');
    console.log(`     --project=${GCP_PROJECT_ID} --region=${GCP_REGION} \\`);
    console.log(`     --service_name=jak-swarm-gateway \\`);
    console.log(`     --env_vars=${envVars}`);

    return { success: false };
  }
}

// ─── Cloud Run Fallback ──────────────────────────────────────────────────────

function deployToCloudRun(): DeployResult {
  console.log('\n🔄 Attempting Cloud Run deployment as fallback...');

  const envVars = `JAK_API_URL=${JAK_API_URL},JAK_API_KEY=${JAK_API_KEY}${GEMINI_API_KEY ? `,GEMINI_API_KEY=${GEMINI_API_KEY}` : ''}`;

  const deployArgs = [
    '@google/adk', 'deploy', 'cloud_run',
    resolve(repoRoot, 'packages/adk/src/deploy'),
    `--project=${GCP_PROJECT_ID}`,
    `--region=${GCP_REGION}`,
    '--service_name=jak-swarm-gateway',
    `--env_vars=${envVars}`,
  ].join(' ');

  try {
    const output = execSync(`npx ${deployArgs}`, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 600_000,
    });

    console.log(output);

    // Extract Cloud Run service URL
    const urlMatch = output.match(/https:\/\/[\w-]+\.run\.app/);
    const serviceUrl = urlMatch ? urlMatch[0] : undefined;

    if (serviceUrl) {
      console.log(`\n✅ Cloud Run deployment successful!`);
      console.log(`  Service URL: ${serviceUrl}`);
      return { success: true, resourceId: `cloud-run:${serviceUrl}`, region: GCP_REGION, displayName: DISPLAY_NAME, rawOutput: output };
    }

    return { success: true, rawOutput: output };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('\n❌ Cloud Run deployment also failed:');
    console.error(`   ${error.message}`);
    return { success: false };
  }
}

// ─── Write Resource File ─────────────────────────────────────────────────────

function writeResourceFile(result: DeployResult): void {
  if (!result.resourceId) {
    console.log('\n⚠️  No resource ID to write. Skipping agent-engine-resource.ts creation.');
    return;
  }

  const timestamp = new Date().toISOString();
  const isCloudRun = result.resourceId.startsWith('cloud-run:');

  const content = isCloudRun
    ? `/**
 * Agent Engine deployment resource — produced by deploy-agent-engine.ts.
 *
 * ⚠️ This file is auto-generated. Do not edit manually.
 * Re-run: npx tsx scripts/deploy-agent-engine.ts
 *
 * Deployment type: Cloud Run (Agent Engine unavailable in this region/project)
 * See scripts/deploy-agent-engine.sh for the original gcloud-based approach.
 */

export const AGENT_ENGINE_RESOURCE_ID = '${result.resourceId}';
export const AGENT_ENGINE_DISPLAY_NAME = '${result.displayName ?? 'jak-swarm-gateway'}';
export const AGENT_ENGINE_REGION = '${result.region ?? GCP_REGION}';
export const AGENT_ENGINE_DEPLOYED_AT = '${timestamp}';
export const AGENT_ENGINE_TYPE = 'cloud-run' as const;
`
    : `/**
 * Agent Engine deployment resource — produced by deploy-agent-engine.ts.
 *
 * ⚠️ This file is auto-generated. Do not edit manually.
 * Re-run: npx tsx scripts/deploy-agent-engine.ts
 *
 * Live reasoningEngines resource — this file is the single source of truth
 * for the Agent Engine deployment status.
 */

export const AGENT_ENGINE_RESOURCE_ID = '${result.resourceId}';
export const AGENT_ENGINE_DISPLAY_NAME = '${result.displayName ?? 'jak-swarm-gateway'}';
export const AGENT_ENGINE_REGION = '${result.region ?? GCP_REGION}';
export const AGENT_ENGINE_DEPLOYED_AT = '${timestamp}';
export const AGENT_ENGINE_TYPE = 'agent-engine' as const;
`;

  writeFileSync(resourceFilePath, content, 'utf8');
  console.log(`\n📝 Resource file written to: ${resourceFilePath}`);
  console.log(`   Resource ID: ${result.resourceId}`);
  console.log(`   Type: ${isCloudRun ? 'Cloud Run' : 'Agent Engine'}`);
  console.log(`   Deployed at: ${timestamp}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  JAK Swarm → Google Agent Engine Deployment                   ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  // Step 1: Validate
  console.log('\n🔍 Validating prerequisites...');
  const validation = validate();
  for (const warning of validation.warnings) {
    console.log(`  ⚠️  ${warning}`);
  }
  for (const error of validation.errors) {
    console.error(`  ❌ ${error}`);
  }
  if (!validation.valid) {
    console.error('\n❌ Prerequisites not met. Fix the errors above and re-run.');
    process.exit(1);
  }
  console.log('✅ Prerequisites met');

  // Step 2: Enable Vertex AI API (idempotent)
  console.log('\n📡 Enabling Vertex AI API...');
  try {
    execSync(`gcloud services enable aiplatform.googleapis.com --project=${GCP_PROJECT_ID} --quiet`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log('✅ Vertex AI API enabled');
  } catch {
    console.log('  (already enabled or not available — continuing)');
  }

  // Step 3: Build
  buildAdkPackage();

  // Step 4: Deploy to Agent Engine
  let result = deployToAgentEngine();

  // Step 4b: Fallback to Cloud Run if Agent Engine fails
  if (!result.success) {
    result = deployToCloudRun();
  }

  // Step 5: Write resource file
  if (result.success) {
    writeResourceFile(result);
  }

  // Step 6: Print test commands
  if (result.success && result.resourceId && !result.resourceId.startsWith('cloud-run:')) {
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('  Test with gcloud:');
    console.log(`    gcloud ai agent-engines run \\`);
    console.log(`      --agent=${result.resourceId.split('/').pop()} \\`);
    console.log(`      --region=${GCP_REGION} \\`);
    console.log(`      --project=${GCP_PROJECT_ID} \\`);
    console.log(`      --input='{"goal": "Analyze our Q3 marketing performance"}'`);
    console.log('');
    console.log('  Or use the REST API:');
    console.log(`    curl -X POST \\`);
    console.log(`      "https://${GCP_REGION}-aiplatform.googleapis.com/v1/${result.resourceId}:query" \\`);
    console.log(`      -H "Authorization: Bearer $(gcloud auth print-access-token)" \\`);
    console.log(`      -H "Content-Type: application/json" \\`);
    console.log(`      -d '{"class_method": "query", "input": {"goal": "Analyze our Q3 marketing performance"}}'`);
    console.log('════════════════════════════════════════════════════════════════');
  }

  console.log('\n✨ Deployment script complete');

  if (!result.success) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});