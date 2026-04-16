import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { BaseLogger } from 'pino';
import type { Redis } from 'ioredis';
import { config } from '../config.js';
import crypto from 'crypto';

type WhatsAppStatus = 'starting' | 'qr' | 'connected' | 'disconnected' | 'error';

type Logger = Pick<BaseLogger, 'info' | 'warn' | 'error'>;

type RedisLike = Pick<Redis, 'set' | 'eval'>;

let whatsappProcess: ChildProcess | null = null;
let lockToken: string | null = null;
let lockRefreshTimer: NodeJS.Timeout | null = null;

const AUTO_START_LOCK_KEY = 'whatsapp-client-autostart';
const AUTO_START_LOCK_TTL_MS = 5 * 60 * 1000;
const AUTO_START_LOCK_REFRESH_MS = 60 * 1000;

function repoRoot(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, '..', '..', '..', '..');
}

async function isClientRunning(): Promise<boolean> {
  const url = `http://localhost:${config.whatsappClientPort}/status`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(1000) });
    if (!resp.ok) return false;
    const payload = (await resp.json()) as { status?: WhatsAppStatus };
    return Boolean(payload.status);
  } catch {
    return false;
  }
}

function buildClientEnv(): Record<string, string> {
  const mapValue = config.whatsappNumberMap
    .map((entry) => `${entry.number}:${entry.tenantId}:${entry.userId}`)
    .join(',');
  return {
    ...process.env,
    WHATSAPP_API_URL: `http://localhost:${config.port}`,
    WHATSAPP_CLIENT_PORT: String(config.whatsappClientPort),
    WHATSAPP_BRIDGE_TOKEN: config.whatsappBridgeToken,
    WHATSAPP_ALLOWED_NUMBERS: config.whatsappAllowedNumbers.join(','),
    WHATSAPP_NUMBER_MAP: mapValue,
  };
}

function buildClientCommand(): { command: string; args: string[]; cwd: string } {
  const root = repoRoot();
  const distPath = join(root, 'packages', 'whatsapp-client', 'dist', 'index.js');
  if (existsSync(distPath)) {
    return { command: process.execPath, args: [distPath], cwd: root };
  }

  const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  return {
    command: pnpmCommand,
    args: ['--filter', '@jak-swarm/whatsapp-client', 'dev'],
    cwd: root,
  };
}

async function acquireAutoStartLock(redis: RedisLike, log: Logger): Promise<boolean> {
  if (lockToken) return true;
  const token = crypto.randomUUID();
  const result = await redis.set(
    `jak:lock:${AUTO_START_LOCK_KEY}`,
    token,
    'PX', AUTO_START_LOCK_TTL_MS,
    'NX',
  );

  if (result !== 'OK') {
    log.info('[whatsapp-client] auto-start lock held by another instance');
    return false;
  }

  lockToken = token;
  lockRefreshTimer = setInterval(async () => {
    if (!lockToken) return;
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("pexpire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;
    try {
      const refreshed = await redis.eval(
        script,
        1,
        `jak:lock:${AUTO_START_LOCK_KEY}`,
        lockToken,
        AUTO_START_LOCK_TTL_MS,
      ) as number;
      if (refreshed !== 1) {
        log.warn('[whatsapp-client] auto-start lock refresh failed');
      }
    } catch (err) {
      log.warn({ err }, '[whatsapp-client] auto-start lock refresh error');
    }
  }, AUTO_START_LOCK_REFRESH_MS);

  return true;
}

async function releaseAutoStartLock(redis: RedisLike, log: Logger): Promise<void> {
  if (!lockToken) return;
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  try {
    await redis.eval(script, 1, `jak:lock:${AUTO_START_LOCK_KEY}`, lockToken);
  } catch (err) {
    log.warn({ err }, '[whatsapp-client] auto-start lock release failed');
  }
  lockToken = null;
  if (lockRefreshTimer) {
    clearInterval(lockRefreshTimer);
    lockRefreshTimer = null;
  }
}

export async function spawnWhatsAppClient(log: Logger, redis?: RedisLike | null): Promise<void> {
  if (!config.whatsappAutoStart) return;
  if (whatsappProcess) return;
  if (await isClientRunning()) {
    log.info('[whatsapp-client] already running; skip auto-start');
    return;
  }

  if (redis && !(await acquireAutoStartLock(redis, log))) {
    return;
  }

  const { command, args, cwd } = buildClientCommand();
  log.info({ command, args }, '[whatsapp-client] auto-starting');

  whatsappProcess = spawn(command, args, {
    cwd,
    env: buildClientEnv(),
    stdio: 'pipe',
  });

  whatsappProcess.stdout?.on('data', (chunk) => {
    const message = String(chunk).trim();
    if (message) log.info(`[whatsapp-client] ${message}`);
  });

  whatsappProcess.stderr?.on('data', (chunk) => {
    const message = String(chunk).trim();
    if (message) log.warn(`[whatsapp-client] ${message}`);
  });

  whatsappProcess.on('exit', (code, signal) => {
    log.warn({ code, signal }, '[whatsapp-client] exited');
    whatsappProcess = null;
  });

  whatsappProcess.on('error', (err) => {
    log.error({ err }, '[whatsapp-client] spawn failed');
    whatsappProcess = null;
  });
}

export async function stopWhatsAppClient(log: Logger): Promise<void> {
  if (!whatsappProcess) return;
  log.info('[whatsapp-client] stopping');
  whatsappProcess.kill('SIGTERM');
  whatsappProcess = null;
  if (lockRefreshTimer) {
    clearInterval(lockRefreshTimer);
    lockRefreshTimer = null;
  }
}

export async function releaseWhatsAppAutoStartLock(log: Logger, redis?: RedisLike | null): Promise<void> {
  if (!redis) return;
  await releaseAutoStartLock(redis, log);
}
