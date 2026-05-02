# Local Runtime Recovery — Docker + Local Stack

Diagnostic + manual recovery steps for the local-only QA loop when Docker
Desktop has stopped. **No production DB or deployment changes happen here.**

## Current host state (live diagnosis)

```
docker version       → CLIENT installed (29.1.5, windows/amd64, context: desktop-linux)
                       DAEMON unreachable: "open //./pipe/dockerDesktopLinuxEngine: file not found"
docker ps            → connection refused (same root cause)
docker info          → CLIENT info only; daemon section absent

Process check:
  Docker Desktop     → NOT running
  com.docker.backend → NOT running
  com.docker.service → INSTALLED but Status=Stopped, StartType=Manual

WSL distros:
  Ubuntu             → Stopped (state=2)
  docker-desktop     → Stopped (state=2)

Ports:
  5433 (Postgres)    → not listening
  6379 (Redis)       → not listening
```

**Root cause:** Docker Desktop GUI is closed. `com.docker.service` is set
to manual start, so closing the GUI killed the entire Linux engine VM
(WSL `docker-desktop` distro stopped). Containers `jak-local-pg` and
`jak-local-redis` exist but cannot be started until the engine is up.

## Recovery — exact steps for the user (Windows + WSL2)

These steps need a real keyboard/mouse on the host. I cannot perform
them from this session.

```powershell
# 1. Hard-reset WSL — recovers if any distro is wedged
wsl --shutdown

# 2. Start Docker Desktop (the GUI brings up the engine VM + service)
# Either click the desktop icon, or:
& "C:\Program Files\Docker\Docker\Docker Desktop.exe"

# 3. Wait ~30-60s for "Docker Desktop is running" in the system tray.
#    The icon should be green/blue solid (not gray).

# 4. Verify the engine is back
docker version    # should show both Client AND Server sections
docker ps         # should list 0 containers (or stopped ones from prior runs)

# 5. Start the JAK local containers
docker start jak-local-pg jak-local-redis
docker ps         # both should show "Up X seconds"

# 6. Confirm ports are listening
Get-NetTCPConnection -State Listen -LocalPort 5433,6379 -ea SilentlyContinue |
  Select LocalPort, OwningProcess
```

If `docker version` still shows daemon-unreachable after Docker Desktop's
tray icon is solid:

```powershell
# Reset Docker Desktop's WSL integration
wsl --shutdown
Stop-Service com.docker.service -Force -ea SilentlyContinue
Start-Service com.docker.service
# Then re-launch the GUI
```

If WSL itself has been broken:

```powershell
wsl --update         # update the kernel
wsl --status         # confirm "Default Distribution: Ubuntu" works
```

## After Docker is back — bring up the JAK local stack

```bash
# From the repo root
cd /c/Users/reetu/Desktop/JAK/jak-swarm

# 1. Confirm migrations are applied (idempotent)
DATABASE_URL=postgresql://postgres:jaktest@localhost:5433/jaktest \
DIRECT_URL=postgresql://postgres:jaktest@localhost:5433/jaktest \
  pnpm --filter @jak-swarm/db exec prisma migrate deploy

# 2. Start the API (background)
cd apps/api && \
  DATABASE_URL=postgresql://postgres:jaktest@localhost:5433/jaktest \
  DIRECT_URL=postgresql://postgres:jaktest@localhost:5433/jaktest \
  REDIS_URL=redis://localhost:6379 PORT=4000 \
  AUTH_SECRET=local-test-secret-not-for-prod-32chars-or-longer-padded \
  JAK_DEV_AUTH_BYPASS=1 OPENAI_API_KEY=sk-test-not-real-local-only \
  WHATSAPP_AUTO_START=0 NODE_ENV=development \
  JAK_FIELD_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  pnpm exec tsx src/index.ts &

# 3. Start the web app (background)
cd ../web && \
  NEXT_PUBLIC_JAK_DEV_AUTH_BYPASS=1 NEXT_PUBLIC_API_URL=http://localhost:4000 \
  pnpm exec next dev &

# 4. Wait for both
until curl -fs --max-time 1 http://localhost:4000/healthz > /dev/null && \
      curl -fs --max-time 1 http://localhost:3000/ > /dev/null; do sleep 2; done
echo "BOTH UP"

# 5. Run the deep A-Z audit
PWHEADLESS=1 pnpm --filter @jak-swarm/tests exec \
  playwright test e2e/human-qa-az.spec.ts --project=chromium-desktop --reporter=line

# 6. Inspect aggregated session report
cat qa/human-qa-reports/a-z-deep/session-report.md
```

## Production-DB guard

Even with all of the above, the test-harness now refuses to start a deep
QA session if `DATABASE_URL` or `DIRECT_URL` resolves to anything that
matches the Supabase production hostname (`*.supabase.com`,
`*.supabase.co`, or anything containing `pooler.supabase`). The guard
fails-loud with the host name in the error message — see
`tests/human-qa/assert-local-only.ts`.

The guard runs in **every** spec that imports it. Adding it to a new
deep spec is a one-liner:

```ts
import { assertLocalOnlyOrThrow } from '../human-qa/assert-local-only.js';
test.beforeAll(() => assertLocalOnlyOrThrow());
```

## Honest status

| Item | State |
|---|---|
| Docker engine | **DOWN** (Docker Desktop GUI not running) |
| jak-local-pg container | exists but stopped |
| jak-local-redis container | exists but stopped |
| Local API | not started |
| Local web | not started |
| Production-DB guard | **NEW** — refuses any test that resolves to Supabase prod |
| Deep A-Z re-run | **blocked** until user starts Docker Desktop |

This document does not claim anything is buyer-ready. It is a recovery
runbook + a guard. The next deep A-Z run produces real scores; until
then, the prior run's evidence (`qa/human-qa-reports/a-z-deep/`) and
my code changes are the only ground truth.
