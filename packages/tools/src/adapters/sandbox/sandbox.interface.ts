/**
 * Sandbox interface for isolated code execution environments.
 * Supports E2B (cloud) and Docker (self-hosted) implementations.
 */

export interface SandboxFileEntry {
  path: string;
  content: string;
}

export interface SandboxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface SandboxInfo {
  id: string;
  status: 'creating' | 'running' | 'stopped' | 'error';
  previewUrl?: string;
  createdAt: Date;
  expiresAt?: Date;
}

export interface SandboxAdapter {
  /**
   * Create a new sandbox environment with optional template.
   * Returns sandbox ID for subsequent operations.
   */
  create(options?: {
    template?: string;       // e.g. 'node', 'nextjs', 'python'
    timeoutMs?: number;      // max lifetime (default 30 min)
    metadata?: Record<string, string>;
  }): Promise<SandboxInfo>;

  /**
   * Write a file to the sandbox filesystem.
   */
  writeFile(sandboxId: string, path: string, content: string): Promise<void>;

  /**
   * Write multiple files at once (more efficient than individual writes).
   */
  writeFiles(sandboxId: string, files: SandboxFileEntry[]): Promise<void>;

  /**
   * Read a file from the sandbox filesystem.
   */
  readFile(sandboxId: string, path: string): Promise<string>;

  /**
   * List files in a directory within the sandbox.
   */
  listFiles(sandboxId: string, directory?: string): Promise<string[]>;

  /**
   * Execute a shell command in the sandbox.
   */
  exec(sandboxId: string, command: string, options?: {
    cwd?: string;
    timeoutMs?: number;
    env?: Record<string, string>;
  }): Promise<SandboxExecResult>;

  /**
   * Install npm dependencies in the sandbox.
   * Equivalent to: exec(id, 'npm install')
   */
  installDeps(sandboxId: string, cwd?: string): Promise<SandboxExecResult>;

  /**
   * Start a dev server (e.g., next dev) and return the preview URL.
   */
  startDevServer(sandboxId: string, options?: {
    command?: string;    // default: 'npm run dev'
    port?: number;       // default: 3000
    cwd?: string;
  }): Promise<string>;  // Returns the publicly accessible URL

  /**
   * Get the current preview URL for a running sandbox.
   */
  getPreviewUrl(sandboxId: string, port?: number): Promise<string | null>;

  /**
   * Get sandbox info and status.
   */
  getInfo(sandboxId: string): Promise<SandboxInfo | null>;

  /**
   * Destroy the sandbox and release all resources.
   */
  destroy(sandboxId: string): Promise<void>;

  /**
   * Check if the sandbox provider is available and configured.
   */
  isAvailable(): boolean;
}
