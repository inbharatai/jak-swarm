export type {
  SandboxAdapter,
  SandboxInfo,
  SandboxExecResult,
  SandboxFileEntry,
} from './sandbox.interface.js';

export { E2BSandboxAdapter, e2bSandbox } from './e2b.adapter.js';
export { DockerSandboxAdapter, dockerSandbox } from './docker.adapter.js';
export {
  PROJECT_TEMPLATES,
  getTemplate,
  listTemplates,
  generatePackageJson,
} from './template-registry.js';
export type { ProjectTemplate } from './template-registry.js';

/**
 * Get the best available sandbox adapter.
 * Prefers E2B (cloud) over Docker (self-hosted).
 */
export function getSandboxAdapter(): import('./sandbox.interface.js').SandboxAdapter {
  const { e2bSandbox: e2b } = require('./e2b.adapter.js') as { e2bSandbox: import('./sandbox.interface.js').SandboxAdapter };
  if (e2b.isAvailable()) return e2b;

  const { dockerSandbox: docker } = require('./docker.adapter.js') as { dockerSandbox: import('./sandbox.interface.js').SandboxAdapter };
  if (docker.isAvailable()) return docker;

  throw new Error(
    'No sandbox provider available. Set E2B_API_KEY for cloud sandboxes or install Docker for local sandboxes.',
  );
}
