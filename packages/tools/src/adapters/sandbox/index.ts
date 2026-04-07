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
 *
 * FIX #15: Use dynamic import instead of require() for ESM compatibility.
 */
export async function getSandboxAdapter(): Promise<import('./sandbox.interface.js').SandboxAdapter> {
  const { e2bSandbox } = await import('./e2b.adapter.js');
  if (e2bSandbox.isAvailable()) return e2bSandbox;

  const { dockerSandbox } = await import('./docker.adapter.js');
  if (dockerSandbox.isAvailable()) return dockerSandbox;

  throw new Error(
    'No sandbox provider available. Set E2B_API_KEY for cloud sandboxes or install Docker for local sandboxes.',
  );
}
