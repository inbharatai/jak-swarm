/**
 * Boot-time MCP auto-launch — Phase C of the integration hardening.
 *
 * Reads `mcp.config.json` from the repo root (or `MCP_CONFIG_PATH`) and
 * auto-starts any deployment-wide MCP server that's `enabled` and has
 * its required env vars present. This is the JAK equivalent of Claude
 * Desktop's mcp.json pattern — operator-configured, not user-configured.
 *
 * What this DOESN'T do:
 *   - Per-tenant MCP: tenants still connect their own MCP integrations
 *     via the ConnectModal (paste creds) or the OAuth flow (Phase A).
 *     Those go through `tenantMcpManager` and get namespaced per tenant.
 *   - Secret management: env vars are read as-is. We never log them.
 *
 * Sample mcp.config.json (checked in at repo root — an .example is OK):
 *   {
 *     "$schema": "https://jakswarm.io/schema/mcp.config.v1.json",
 *     "version": 1,
 *     "providers": {
 *       "FILESYSTEM": {
 *         "enabled": true,
 *         "env": {
 *           "ALLOWED_DIRS": "env:FILESYSTEM_ALLOWED_DIRS"
 *         }
 *       },
 *       "BRAVE_SEARCH": {
 *         "enabled": true,
 *         "env": {
 *           "BRAVE_API_KEY": "env:BRAVE_API_KEY"
 *         }
 *       },
 *       "SEQUENTIAL_THINKING": { "enabled": true, "env": {} }
 *     }
 *   }
 *
 * Env-var substitution: any value of the form `env:FOO_BAR` is replaced
 * by `process.env.FOO_BAR` at boot. If the env var is missing and the
 * provider's credentialFields marks that key required, the provider is
 * skipped with a warning. Literal values (no `env:` prefix) are used as-is.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { mcpClientManager, MCP_PROVIDERS } from '@jak-swarm/tools';
import type { FastifyBaseLogger } from 'fastify';

interface ProviderEntry {
  enabled: boolean;
  env?: Record<string, string>;
}

interface McpConfig {
  version: number;
  providers: Record<string, ProviderEntry>;
}

function resolveConfigPath(): string {
  if (process.env['MCP_CONFIG_PATH']) return process.env['MCP_CONFIG_PATH'];
  // Repo root relative to the dist directory at apps/api/dist/boot/
  return path.resolve(process.cwd(), 'mcp.config.json');
}

async function loadConfig(configPath: string, log: FastifyBaseLogger): Promise<McpConfig | null> {
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // No config file — totally fine. Operators opt in by creating one.
      log.debug({ configPath }, '[mcp-autostart] No mcp.config.json present; skipping auto-launch');
      return null;
    }
    log.warn({ err, configPath }, '[mcp-autostart] Failed to read mcp.config.json');
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    // Very light validation — we don't want to pull in zod just for this
    // and the failure mode (skip the provider) is safe.
    if (typeof parsed !== 'object' || parsed === null) {
      log.warn({ configPath }, '[mcp-autostart] mcp.config.json is not an object');
      return null;
    }
    const cfg = parsed as Partial<McpConfig>;
    if (typeof cfg.version !== 'number' || !cfg.providers || typeof cfg.providers !== 'object') {
      log.warn({ configPath }, '[mcp-autostart] mcp.config.json missing `version` or `providers`');
      return null;
    }
    if (cfg.version !== 1) {
      log.warn(
        { configPath, version: cfg.version },
        `[mcp-autostart] mcp.config.json version ${cfg.version} is not supported (expected 1)`,
      );
      return null;
    }
    return cfg as McpConfig;
  } catch (err) {
    log.error({ err, configPath }, '[mcp-autostart] mcp.config.json is not valid JSON');
    return null;
  }
}

/**
 * Substitute `env:FOO` placeholders in a credential env map with the
 * actual process.env values. Returns the resolved map plus the list of
 * required env vars that were missing (caller decides whether to skip).
 */
function resolveEnvRefs(envMap: Record<string, string>): {
  resolved: Record<string, string>;
  missing: string[];
} {
  const resolved: Record<string, string> = {};
  const missing: string[] = [];
  for (const [key, rawValue] of Object.entries(envMap)) {
    if (typeof rawValue !== 'string') continue;
    if (rawValue.startsWith('env:')) {
      const envVarName = rawValue.slice(4);
      const envValue = process.env[envVarName];
      if (envValue && envValue.length > 0) {
        resolved[key] = envValue;
      } else {
        missing.push(envVarName);
      }
    } else {
      resolved[key] = rawValue;
    }
  }
  return { resolved, missing };
}

/**
 * Run once during buildApp(), after Fastify plugins have registered but
 * before the server starts listening. Synchronous-ish: each provider
 * connect is awaited, but a slow one won't hold the whole boot (we wrap
 * the whole thing in a 20s timeout per provider).
 */
export async function startMcpServersFromConfig(log: FastifyBaseLogger): Promise<void> {
  const configPath = resolveConfigPath();
  const cfg = await loadConfig(configPath, log);
  if (!cfg) return;

  const providerKeys = Object.keys(cfg.providers);
  if (providerKeys.length === 0) {
    log.info('[mcp-autostart] mcp.config.json has no providers declared');
    return;
  }

  log.info(
    { configPath, providers: providerKeys },
    `[mcp-autostart] Auto-starting ${providerKeys.length} provider(s) from mcp.config.json`,
  );

  let started = 0;
  let skipped = 0;
  let failed = 0;

  for (const [providerKey, entry] of Object.entries(cfg.providers)) {
    const providerUpper = providerKey.toUpperCase();

    if (!entry.enabled) {
      log.debug({ provider: providerUpper }, '[mcp-autostart] Provider disabled; skipping');
      skipped++;
      continue;
    }

    const providerDef = MCP_PROVIDERS[providerUpper];
    if (!providerDef) {
      log.warn(
        { provider: providerUpper, knownProviders: Object.keys(MCP_PROVIDERS).length },
        '[mcp-autostart] Unknown provider in mcp.config.json',
      );
      skipped++;
      continue;
    }

    const { resolved: resolvedEnv, missing } = resolveEnvRefs(entry.env ?? {});
    if (missing.length > 0) {
      log.warn(
        { provider: providerUpper, missingEnv: missing },
        `[mcp-autostart] Skipping ${providerUpper} — required env var(s) missing`,
      );
      skipped++;
      continue;
    }

    try {
      // buildConfig takes a credentials map (not an env map) — but for
      // Filesystem, Fetch, SequentialThinking etc. there are no
      // credentialFields, so the empty map is fine. For providers that
      // DO have credentialFields (Slack, GitHub) operators either
      // pre-set env vars matching the field keys OR shouldn't auto-start.
      const spawnConfig = providerDef.buildConfig(resolvedEnv);

      // 20s timeout wraps the connect so a hung MCP server doesn't block
      // boot indefinitely. `mcpClientManager.connect` already handles
      // process spawn + stdio tool enumeration.
      const connectPromise = mcpClientManager.connect(providerUpper, spawnConfig);
      const timeoutMs = 20_000;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`MCP connect timed out after ${timeoutMs}ms`)), timeoutMs),
      );

      const tools = await Promise.race([connectPromise, timeoutPromise]);
      log.info(
        { provider: providerUpper, toolCount: tools.length },
        `[mcp-autostart] Started ${providerUpper} with ${tools.length} tool(s)`,
      );
      started++;
    } catch (err) {
      log.error(
        { provider: providerUpper, err: err instanceof Error ? err.message : String(err) },
        `[mcp-autostart] Failed to start ${providerUpper}`,
      );
      failed++;
    }
  }

  log.info(
    { started, skipped, failed, total: providerKeys.length },
    `[mcp-autostart] Boot summary: ${started} started, ${skipped} skipped, ${failed} failed`,
  );
}
