/**
 * Remotion connector manifest.
 *
 * Remotion is a programmable video-generation engine: React components
 * compile into MP4s, image sequences, or audio. JAK's Media Producer
 * agent uses Remotion to turn a brand kit + a prompt into branded
 * video deliverables — investor pitch clips, product demos, social
 * reels, onboarding videos — without a human opening a video editor.
 *
 * Status today (2026-04-29): registered as `available`. The Connector
 * Runtime can install Remotion via `npx create-video@latest` AFTER
 * explicit user approval and validate via `npx remotion --version`,
 * but neither happens at boot. Marketing copy must read the live
 * registry status — never claim Remotion is shipped/installed in any
 * marketing surface unless `connectorRegistry.get('remotion').status`
 * is `installed` or `configured`.
 *
 * Honesty notes:
 *   - We do NOT auto-install Remotion. The user (or a tenant-admin
 *     with trusted auto-approval enabled) explicitly approves the
 *     install on first use.
 *   - We do NOT publish rendered videos to social platforms. That is
 *     a separate connector with its own approval gate; Remotion
 *     produces the file, the publisher uploads it.
 *   - We do NOT assume cloud-render credentials. AWS Lambda or Cloud
 *     Run rendering requires extra credentials the user supplies via
 *     the standard IntegrationCredential flow; without them, the
 *     installer falls back to local render.
 *   - Validation is a separate Connector Runtime concern (executed by
 *     the installer service). The manifest just declares what to run
 *     and what success looks like; it does not run anything itself.
 */

import { RiskLevel } from '@jak-swarm/shared';
import type { ConnectorManifest } from '../types.js';

export const REMOTION_MANIFEST: ConnectorManifest = {
  id: 'remotion',
  name: 'Remotion',
  category: 'media',
  description:
    'Programmable video generation in React. JAK turns brand kits + prompts into branded MP4s, social reels, and product demos.',
  runtimeType: 'node_cli',
  installMethod: 'npx',
  installCommand: 'npx --yes create-video@latest',
  // Lock to the official @remotion org + the create-video bootstrapper.
  // CI rejects any future installCommand that points elsewhere.
  sourceAllowlist: ['@remotion/cli', 'create-video', '@remotion/lambda', '@remotion/cloudrun'],
  validationCommand: 'npx --yes remotion --version',
  validationExpectedOutput: '^[0-9]+\\.[0-9]+',
  availableTools: [
    // Tools the Connector Runtime registers in ToolRegistry once
    // Remotion is installed + configured. Names mirror existing
    // ToolRegistry naming convention (snake_case verbs).
    'remotion_create_project',
    'remotion_render_video',
    'remotion_render_lambda',
    'remotion_list_compositions',
    'remotion_generate_caption_track',
  ],
  riskLevel: RiskLevel.MEDIUM,
  approvalRequired: true,
  // Remotion install + local render is medium-risk + idempotent inside
  // a sandboxed project folder. Tenant-admins can flip auto-approve on
  // for the install + render steps. Publish steps are NEVER auto-approved
  // (separate connector, separate gate).
  supportsAutoApproval: true,
  supportsSandbox: true,
  supportsCloud: true, // Lambda + Cloud Run optional, off by default
  supportsLocal: true,
  canModifyFiles: true,
  canPublishExternalContent: false, // file is produced; publisher uploads
  canAccessUserData: false,
  defaultEnabled: false,
  docsUrl: 'https://www.remotion.dev/',
  environmentVariablesRequired: [
    // Optional. Only required for cloud rendering paths.
    'REMOTION_AWS_REGION',
    'REMOTION_AWS_ACCESS_KEY_ID',
    'REMOTION_AWS_SECRET_ACCESS_KEY',
    'REMOTION_LAMBDA_FUNCTION_NAME',
  ],
  setupInstructions: [
    '## Setting up Remotion',
    '',
    'Remotion is installed on first use via `npx --yes create-video@latest` after you approve the install. Local rendering needs Node 18+ and Chromium (auto-downloaded by Remotion on first render).',
    '',
    '### Optional: cloud rendering',
    '',
    'For AWS Lambda or Google Cloud Run rendering, supply the credentials below. Without them, JAK falls back to local rendering.',
    '',
    '- `REMOTION_AWS_REGION` — e.g. `us-east-1`',
    '- `REMOTION_AWS_ACCESS_KEY_ID` — AWS access key with Lambda + S3 permissions',
    '- `REMOTION_AWS_SECRET_ACCESS_KEY`',
    '- `REMOTION_LAMBDA_FUNCTION_NAME` — once you deploy the Remotion Lambda function',
    '',
    'See https://www.remotion.dev/docs/lambda for the Lambda deployment walkthrough.',
  ].join('\n'),
  source: 'manual',
};
