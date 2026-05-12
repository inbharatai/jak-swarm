import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const apiPort = process.env['E2E_API_PORT'] ?? '4000';
const webPort = process.env['E2E_WEB_PORT'] ?? '3100';

// The local e2e stack runs Playwright, Testcontainers, Prisma, pnpm, and the
// API child process together; each can register shutdown hooks legitimately.
process.setMaxListeners(Math.max(process.getMaxListeners(), 100));

const pnpmBin = 'pnpm';
const isWindows = process.platform === 'win32';

let postgres: StartedTestContainer | null = null;
let apiProcess: ChildProcess | null = null;
let shuttingDown = false;

function runPnpm(args: string[], env: NodeJS.ProcessEnv) {
  const command = isWindows ? 'cmd.exe' : pnpmBin;
  const commandArgs = isWindows ? ['/d', '/s', '/c', [pnpmBin, ...args].join(' ')] : args;
  execFileSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    env,
  });
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (apiProcess && !apiProcess.killed) {
    apiProcess.kill('SIGTERM');
  }

  if (postgres) {
    await postgres.stop().catch((error: unknown) => {
      console.error('[e2e-api-stack] Failed to stop Postgres container:', error);
    });
  }

  process.exit(exitCode);
}

async function main() {
  console.log('[e2e-api-stack] Starting disposable pgvector/Postgres...');
  postgres = await new GenericContainer('pgvector/pgvector:pg16')
    .withEnvironment({
      POSTGRES_DB: 'jakswarm',
      POSTGRES_USER: 'jakswarm',
      POSTGRES_PASSWORD: 'jakswarm',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/i))
    .start();

  const host = postgres.getHost();
  const port = postgres.getMappedPort(5432);
  const dbUrl = `postgresql://jakswarm:jakswarm@${host}:${port}/jakswarm`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'development',
    API_PORT: apiPort,
    PORT: apiPort,
    DATABASE_URL: dbUrl,
    DIRECT_URL: dbUrl,
    AUTH_SECRET: process.env['AUTH_SECRET'] ?? 'e2e-local-auth-secret-change-me',
    JAK_DEV_AUTH_BYPASS: '1',
    OPENAI_API_KEY: process.env['OPENAI_API_KEY'] ?? 'sk-test-local-e2e-0000',
    REDIS_URL: '',
    REQUIRE_REDIS_IN_PROD: 'false',
    WHATSAPP_AUTO_START: '0',
    LOG_LEVEL: process.env['LOG_LEVEL'] ?? 'warn',
    CORS_ORIGINS: process.env['CORS_ORIGINS'] ?? `http://127.0.0.1:${webPort},http://localhost:${webPort}`,
    API_PUBLIC_URL: process.env['API_PUBLIC_URL'] ?? `http://127.0.0.1:${apiPort}`,
    WEB_PUBLIC_URL: process.env['WEB_PUBLIC_URL'] ?? `http://127.0.0.1:${webPort}`,
    NEXT_PUBLIC_SUPABASE_URL: process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? 'local-e2e-placeholder',
  };

  console.log('[e2e-api-stack] Applying Prisma migrations...');
  runPnpm(['--filter', '@jak-swarm/db', 'db:migrate:deploy'], env);

  console.log('[e2e-api-stack] Seeding dev-bypass tenant/user...');
  runPnpm(['--filter', '@jak-swarm/db', 'exec', 'tsx', '../../scripts/seed-dev-bypass.ts'], env);

  console.log(`[e2e-api-stack] Starting API on http://127.0.0.1:${apiPort} ...`);
  const apiArgs = ['--filter', '@jak-swarm/api', 'dev'];
  apiProcess = spawn(
    isWindows ? 'cmd.exe' : pnpmBin,
    isWindows ? ['/d', '/s', '/c', [pnpmBin, ...apiArgs].join(' ')] : apiArgs,
    {
      cwd: repoRoot,
      stdio: 'inherit',
      env,
    },
  );

  apiProcess.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`[e2e-api-stack] API exited unexpectedly code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      void shutdown(code ?? 1);
    }
  });
}

process.once('SIGINT', () => void shutdown(130));
process.once('SIGTERM', () => void shutdown(143));
process.once('uncaughtException', (error) => {
  console.error('[e2e-api-stack] Uncaught exception:', error);
  void shutdown(1);
});
process.once('unhandledRejection', (error) => {
  console.error('[e2e-api-stack] Unhandled rejection:', error);
  void shutdown(1);
});

main().catch((error) => {
  console.error('[e2e-api-stack] Failed to start:', error);
  void shutdown(1);
});
