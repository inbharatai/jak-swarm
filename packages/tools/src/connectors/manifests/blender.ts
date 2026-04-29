/**
 * Blender connector manifest.
 *
 * Blender is a desktop 3D creation suite. JAK reaches it through the
 * community-maintained Blender MCP server (ahujasid/blender-mcp), which
 * exposes Blender's Python API over MCP stdio. Use cases: scene
 * inspection, material/node debugging, modifier batch-application, and
 * export pipelines for the Designer + Media Producer agents.
 *
 * Status today (2026-04-29): registered as `needs_user_setup`. Unlike
 * Remotion (a pure npm CLI), Blender requires the user to:
 *   1. Install Blender desktop on their own machine
 *   2. Open Blender + load the MCP plug-in
 *   3. Confirm the MCP server is listening on the configured stdio
 *
 * The Connector Runtime cannot automate any of those steps from the
 * cloud — they are local-machine actions. Manifest reflects that
 * honestly via `manualSetupSteps` (which auto-flips status to
 * `needs_user_setup` at registration time).
 *
 * The Anthropic-published Claude for Creative Work direction validates
 * Blender as a connector-worthy surface; JAK borrows the architectural
 * pattern (MCP plug-in to desktop app) without copying any code.
 *
 * Honesty notes:
 *   - We do NOT bundle or distribute Blender. Marketing copy must say
 *     "Blender connector available" not "Blender included".
 *   - We do NOT auto-export rendered scenes. Export is a separate tool
 *     call gated by canModifyFiles + approval.
 *   - This connector is COMMUNITY-maintained — not officially supported
 *     by Blender Foundation. Surfaced via packageStatus in the manifest.
 */

import { RiskLevel } from '@jak-swarm/shared';
import type { ConnectorManifest } from '../types.js';

export const BLENDER_MANIFEST: ConnectorManifest = {
  id: 'blender',
  name: 'Blender',
  category: 'creative',
  description:
    "Inspect, debug, and modify Blender 3D scenes via Blender's Python API over MCP. Designer + Media Producer agents reach scene objects, materials, modifiers, and the export pipeline.",
  runtimeType: 'mcp',
  installMethod: 'mcp-stdio',
  // The MCP plug-in side comes from the community blender-mcp project.
  // CI rejects any installCommand that does not match this allowlist,
  // and the install runs only after explicit user approval.
  installCommand: 'pip install blender-mcp',
  sourceAllowlist: ['blender-mcp', 'ahujasid/blender-mcp'],
  // No remote validation_command — the MCP runtime does its own handshake
  // when the server starts. Status flips to `installed` only after the
  // McpClientManager handshake succeeds AND tools are discovered.
  manualSetupSteps: [
    '1. Download and install **Blender 4.0+** from https://www.blender.org/download/',
    '2. In Blender, install the **Blender MCP** add-on (Edit → Preferences → Add-ons → Install)',
    '3. Enable the add-on and click "Start MCP Server" in its sidebar panel',
    '4. Back in JAK, click **Connect** below — JAK will register the MCP stdio session and discover the available tools',
    '',
    'Blender desktop must remain running while you use this connector. If you close Blender, the MCP session terminates and the connector status drops to `failed_validation`.',
  ],
  availableTools: [
    'blender_inspect_scene',
    'blender_list_objects',
    'blender_get_material',
    'blender_apply_modifier',
    'blender_run_python',
    'blender_export_scene',
  ],
  // High risk because the python_run tool can execute arbitrary code in
  // the Blender process. Approval gate enforced regardless of tenant
  // auto-approve settings (see registry.setStatus rules + approval-node
  // threshold).
  riskLevel: RiskLevel.HIGH,
  approvalRequired: true,
  supportsAutoApproval: false, // never auto-approve a Python-execution surface
  supportsSandbox: false, // Blender desktop is not sandboxable from here
  supportsCloud: false, // there's no Blender-as-a-service we use
  supportsLocal: true,
  canModifyFiles: true, // exports + saves write to disk
  canPublishExternalContent: false,
  canAccessUserData: false,
  defaultEnabled: false,
  docsUrl: 'https://github.com/ahujasid/blender-mcp',
  packageStatus: 'COMMUNITY',
  setupInstructions: [
    '## Setting up Blender',
    '',
    'Blender is a desktop application — JAK cannot install it for you. Once Blender is running locally with the MCP add-on enabled, JAK reaches it over a stdio MCP session.',
    '',
    'Risk note: this connector exposes `blender_run_python`, which executes arbitrary Python in your Blender process. Every call is gated by the JAK approval queue and is never auto-approved, even in tenants that have auto-approval enabled for medium-risk connectors.',
  ].join('\n'),
  source: 'manual',
};
