# JAK Swarm Web (`apps/web`)

Next.js 16 App Router client for `jakswarm.com` (Vercel). Talks to the Fastify
API in `apps/api` (Cloud Run primary, Railway fallback).

## Production environment verification (Phase A)

Run these against the **production** Vercel environment before declaring Phase
A shipped. The web is a client bundle, so `NEXT_PUBLIC_*` values are baked in
at **build** time — a wrong value means a redeploy, not a runtime restart.

```bash
# 1. Link the project (one-time) and pull the production env locally.
vercel link
vercel env ls production

# 2. Verify each critical var (pull + inspect — do NOT print secrets to CI logs).
vercel env pull .env.production.local --environment=production
```

| Variable | Required value | Why |
|----------|----------------|-----|
| `NEXT_PUBLIC_API_URL` | The live Cloud Run URL (`https://jak-swarm-api-….asia-south1.run.app`), **not** `localhost` | `resolveAuthApiBaseUrl` (`src/lib/auth.ts`) throws in prod if this is unset or points at localhost — the build fails fast, but a stale value pointing at Railway is a silent perf regression (no JAK JWT exchange with Cloud Run). |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` (project origin, **not** `.../rest/v1`) | Browser Supabase client + the server middleware (`src/proxy.ts`) use this. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The Supabase anon key (public-safe) | Required for `createBrowserClient` / `createServerClient`. |
| `NEXT_PUBLIC_JAK_DEV_AUTH_BYPASS` | **UNSET / empty** in production | See below — this is the critical one. |

`AUTH_SECRET` is API-side (Cloud Run + Railway) — see
[`apps/api/DEPLOY.md`](../api/DEPLOY.md). It must match across both surfaces.

### `NEXT_PUBLIC_JAK_DEV_AUTH_BYPASS` MUST be unset in production

This flag is the **web-side** dev auth bypass. When `=1`, `useAuth`
(`src/lib/auth.ts:26`) short-circuits to a hard-coded synthetic dev user
(`DEV_BYPASS_USER`) and skips Supabase entirely. Unlike the API bypass (which
is triple-gated: env flag + `NODE_ENV !== production` + the literal
`Bearer jak-dev-bypass` token), the web bypass is **single-gated** — only the
env flag. And because it is `NEXT_PUBLIC_*`, it is compiled into the client
bundle at build time.

**If `NEXT_PUBLIC_JAK_DEV_AUTH_BYPASS=1` is present in the Vercel production
environment at build time, every visitor to `jakswarm.com` is "authenticated"
as the dev user.** That is a critical auth bypass in prod.

> ⚠️ The comment in `.env.example` that says "Production builds strip
> NEXT_PUBLIC_* flags they don't see, so this can't accidentally ship to prod"
> is **wrong** and is being corrected. `NEXT_PUBLIC_*` vars present in the
> build environment ARE inlined into the client bundle. Verify explicitly:

```bash
# Must print nothing (or only the comment in .env.example):
vercel env grep JAK_DEV_AUTH_BYPASS production
# Or inspect the pulled file:
grep JAK_DEV_AUTH_BYPASS .env.production.local   # expect: no '1' value
```

If it is set to `1` in production: `vercel env rm NEXT_PUBLIC_JAK_DEV_AUTH_BYPASS production` then redeploy. The API-side bypass is separately gated and is not affected by this var, but the web bypass alone is sufficient to expose the cockpit, so it must be unset.

## JAK JWT exchange (A.1) — what shipped

`fetchTrustedAuthUser` (`src/lib/auth.ts`) now reads a `jakToken` field from
the `/auth/me` response and stores it via `setToken`. Once stored, every
subsequent API call authenticates via the API's `jwtVerify()` on the first
try — no Supabase `/auth/v1/user` round-trip. This is the fix for "even when
log in its slow to log in": the per-request Supabase fetch was the bottleneck.

Backward compatibility: if `jakToken` is absent (old API still deploying), the
web keeps using the Supabase access token it already stored — no breakage
during the API-then-web rollout (see `apps/api/DEPLOY.md` §3).

Logout already wipes `jak-auth-token` (localStorage) + the `jak-auth-token`
cookie. Token rotation: Supabase access tokens rotate via `onAuthStateChange`;
the next `/auth/me` re-exchanges and overwrites the stored JAK JWT.

## Landing performance (A.3–A.6)

- `/` is a **Server Component** rendered as `○ (Static)` (verify with `pnpm
  --filter @jak-swarm/web build`). The interactive bits are isolated as
  client islands: `LandingRedirectClient` (auth redirect, renders nothing)
  and `LandingNavClient` (mobile hamburger). The hero entrance is pure CSS
  (`@keyframes hero-enter`), no `useState`/`useEffect`.
- The render-blocking Fontshare `<link>` for Satoshi was removed from
  `src/app/layout.tsx`; `font-sans` falls back to the OS UI stack
  (`tailwind.config.ts`). No self-hosted Satoshi file ships in `public/fonts`.
- Below-fold framer-motion sections are code-split via `next/dynamic`
  (`ssr:true` default — still pre-rendered for SEO, each in its own chunk).
- `recharts` is isolated in `src/modules/analytics/AnalyticsCharts.tsx` and
  loaded via `next/dynamic({ ssr:false })`, so the recharts + SVG renderer
  chunk only loads when the Analytics module is opened.
- `next.config.ts` hardens: `reactStrictMode`,
  `experimental.optimizePackageImports` for barrel-heavy libs,
  `compiler.removeConsole` in prod (keeps `error`/`warn`), AVIF/WebP images.
  Bundle analysis: `pnpm --filter @jak-swarm/web analyze` (gated on
  `ANALYZE=true`).

## Local dev

```bash
pnpm install
pnpm --filter @jak-swarm/web dev          # http://localhost:3000 (Turbopack)
pnpm --filter @jak-swarm/web typecheck
pnpm --filter @jak-swarm/web build
pnpm --filter @jak-swarm/web test
```

`@supabase/auth-helpers-nextjs` was removed (unused). Supabase SSR is wired
through `@supabase/ssr` in `src/lib/supabase.ts` (browser) +
`src/lib/supabase-server.ts` (server) + `src/proxy.ts` (the Next 16
middleware — the renamed `middleware.ts`).