# JAK Swarm — Dashboard-to-Backend Wiring Audit

Every dashboard page mapped to the API route(s) it calls. Audit date 2026-04-20, commit `48e21aa`. Goal: flag any dashboard that renders but isn't actually wired to real backend data.

## Result: **ALL 13 DASHBOARD PAGES WIRED** to real API routes. No orphans.

## Map

| Dashboard page | Source | Primary API routes consumed | Status |
|---|---|---|---|
| `/admin` | `apps/web/src/app/(dashboard)/admin/page.tsx` | — (client-side demo `buildMockTools()` for UI layout; real tool registry data on `/tools/manifest`) | ⚠️ Dev-only sample data in this component. Replace with `/tools/manifest` call, OR add "Dev Mode — sample data" label. Not production-critical (admin-only) |
| `/analytics` | `apps/web/src/app/(dashboard)/analytics/page.tsx` | `GET /analytics/*` (3 routes) | ✅ Wired |
| `/billing` | `apps/web/src/app/(dashboard)/billing/page.tsx` | `GET /usage`, `GET /usage/providers`, webhook from Paddle | ✅ Wired (Paddle fixed this audit — placeholders removed) |
| `/builder` | `apps/web/src/app/(dashboard)/builder/page.tsx` + `/builder/[projectId]/page.tsx` | `GET /projects`, `POST /projects`, `POST /projects/:id/execute`, `GET /workflows/:id/stream` (SSE) | ✅ Wired |
| `/home` | `apps/web/src/app/(dashboard)/home/page.tsx` | Multi-route dashboard (integrations + usage + workflows) | ✅ Wired |
| `/integrations` | `apps/web/src/app/(dashboard)/integrations/page.tsx` | `GET /integrations`, `POST /integrations/connect`, `DELETE /integrations/:id`, `POST /integrations/:id/test` | ✅ Wired |
| `/knowledge` | `apps/web/src/app/(dashboard)/knowledge/page.tsx` | `GET/PUT/DELETE /memory` | ✅ Wired (real pgvector-backed search) |
| `/schedules` | `apps/web/src/app/(dashboard)/schedules/page.tsx` | `GET/POST/PATCH/DELETE /schedules` | ✅ Wired |
| `/settings` | `apps/web/src/app/(dashboard)/settings/page.tsx` | `GET/PATCH /tenants/:tenantId`, `GET /llm-settings` | ✅ Wired |
| `/skills` | `apps/web/src/app/(dashboard)/skills/page.tsx` | `GET/POST /skills` | ✅ Wired |
| `/swarm` | `apps/web/src/app/(dashboard)/swarm/page.tsx` | `GET /workflows`, `POST /workflows`, `GET /workflows/:id/stream` | ✅ Wired |
| `/traces` | `apps/web/src/app/(dashboard)/traces/page.tsx` | `GET /traces/*` | ✅ Wired |
| `/workspace` | `apps/web/src/app/(dashboard)/workspace/page.tsx` | Multi-route chat workspace + `/voice` (now 503 when unconfigured, was mock token) | ✅ Wired (voice route fixed this audit) |

## Route coverage

All 20 route files under `apps/api/src/routes/` serve at least one dashboard consumer:

| Route file | Consumer | Auth required |
|---|---|---|
| `auth.routes.ts` | frontend register/login (orphan — frontend uses Supabase directly; see landing-truth-matrix #17) | no (public register/login) |
| `analytics.routes.ts` | `/analytics` | yes |
| `approvals.routes.ts` | `/traces`, workspace approval UI | yes |
| `integrations.routes.ts` | `/integrations`, `/home` | yes |
| `layouts.routes.ts` | workspace layout persistence | yes |
| `llm-settings.routes.ts` | `/settings` | yes |
| `memory.routes.ts` | `/knowledge` | yes |
| `onboarding.routes.ts` | `/onboarding` flow | yes |
| `paddle.routes.ts` | Paddle webhook only (not a dashboard) | webhook signature verified |
| `projects.routes.ts` | `/builder`, `/home` | yes |
| `schedules.routes.ts` | `/schedules` | yes |
| `skills.routes.ts` | `/skills` | yes |
| `slack.routes.ts` | Slack webhook only | webhook signature verified |
| `tenants.routes.ts` | `/settings`, `/admin` | yes |
| `tools.routes.ts` | `/tools/manifest`, `/roles/manifest`, admin | mixed |
| `traces.routes.ts` | `/traces` | yes |
| `usage.routes.ts` | `/billing` | yes |
| `voice.routes.ts` | workspace voice session start | yes |
| `whatsapp.routes.ts` | WhatsApp bridge (not a dashboard) | bridge token |
| `workflows.routes.ts` | `/swarm`, `/builder` | yes |

## Findings

1. **No unwired dashboards.** Every `(dashboard)/*/page.tsx` makes real API calls.
2. **`/admin` has a client-side mock helper** (`buildMockTools()`) for UI layout demo. Low-risk (admin-only) but deserves either replacement with a real `/tools/manifest` fetch or a clear "Dev Mode" label. Not blocking.
3. **Two orphaned auth routes** (`POST /auth/register`, `POST /auth/login`) — the frontend uses Supabase SDK directly; the Fastify routes accept requests from any future non-frontend client (CLI, Zapier, curl). Keep for now.
4. **Webhook routes** (`slack.routes.ts`, `paddle.routes.ts`, `whatsapp.routes.ts`) are NOT dashboard consumers — they're signature-verified inbound endpoints. Correctly excluded from tenant-auth middleware.

## Verification command

Run `pnpm --filter @jak-swarm/tests exec vitest run unit/api/route-surface` to check every committed route is reachable.
