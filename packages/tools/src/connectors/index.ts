/**
 * Connector Runtime — public API surface.
 *
 * Importing this module bootstraps the registry (via the manifests
 * index re-export). Consumers should always go through this barrel
 * and never reach into `./registry.js` or `./manifests/*` directly,
 * so future refactors can move things around without breaking calls.
 */

export type {
  ConnectorManifest,
  ConnectorStatus,
  ConnectorRuntimeType,
  ConnectorView,
  ConnectorCandidate,
  ConnectorResolveResult,
  ConnectorCredentialField,
} from './types.js';
export { connectorRegistry } from './registry.js';
export type { ConnectorRegistry } from './registry.js';
export {
  bootstrapConnectorRegistry,
  REMOTION_MANIFEST,
  BLENDER_MANIFEST,
} from './manifests/index.js';
export { resolveConnectorsForTask } from './resolver.js';
export type { ResolveOptions } from './resolver.js';
