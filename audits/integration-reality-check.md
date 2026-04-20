# JAK Swarm — Integration Reality Check

Every integration claimed on the landing page, mapped to its actual code path + credentials + maturity. Audit date 2026-04-20, commit `48e21aa`.

## Taxonomy

- **Native**: custom-coded adapter in `packages/tools/src/adapters/` or `apps/api/src/routes/*.ts` — full control.
- **MCP (Official)**: configured via `MCP_PROVIDERS[X].buildConfig()` spawns Anthropic-published OR provider-published MCP server. Credentials flow through `IntegrationCredential` table (encrypted).
- **MCP (Community)**: same shape, non-official package. Slightly less stable.

## Matrix (after this audit's fixes)

### INTEGRATIONS_CORE (13 tiles — was 12, +WhatsApp)

| # | Name | Adapter type | Code path | Auth | Maturity | Landing tile | Reality |
|---|---|---|---|---|---|---|---|
| 1 | Slack | Native + MCP | `apps/api/src/routes/slack.routes.ts` (webhook, HMAC-verified) + `MCP_PROVIDERS.SLACK` | signing secret + bot token | production-ready | ✅ Shown | ✅ Real, both sides |
| 2 | GitHub | MCP (Official) | `MCP_PROVIDERS.GITHUB` — Anthropic-published `@modelcontextprotocol/server-github` | Personal Access Token (PAT) | beta | ✅ Shown | ✅ Real |
| 3 | Notion | MCP (Official) | `MCP_PROVIDERS.NOTION` | Notion integration token | beta | ✅ Shown | ✅ Real |
| 4 | Google Drive | MCP (Community) | `MCP_PROVIDERS.GDRIVE` | OAuth / service account | partial | ✅ Shown | ✅ Real config |
| 5 | Linear | MCP (Official) | `MCP_PROVIDERS.LINEAR:361-379` — real buildConfig, credentialFields, testToolName | API key | beta | ✅ Shown | ✅ Real (pre-audit flag was FALSE) |
| 6 | HubSpot | MCP (Official) | `MCP_PROVIDERS.HUBSPOT` | OAuth access token | beta | ✅ Shown | ✅ Real |
| 7 | Stripe | MCP (Official) | `MCP_PROVIDERS.STRIPE` | restricted API key | beta | ✅ Shown | ✅ Real |
| 8 | Salesforce | MCP (Official) | `MCP_PROVIDERS.SALESFORCE:380-397` — real buildConfig with instanceUrl + accessToken fields | OAuth | partial | ✅ Shown | ✅ Real (pre-audit flag was FALSE) |
| 9 | Airtable | MCP (Community) | `MCP_PROVIDERS.AIRTABLE` | Personal Access Token | partial | ✅ Shown | ✅ Real config |
| 10 | ClickUp | MCP (Community) | `MCP_PROVIDERS.CLICKUP` | API token | partial | ✅ Shown | ✅ Real config |
| 11 | SendGrid | MCP (Community) | `MCP_PROVIDERS.SENDGRID` | API key | partial | ✅ Shown | ✅ Real config |
| 12 | Discord | MCP (Community) | `MCP_PROVIDERS.DISCORD` | bot token | partial | ✅ Shown | ✅ Real config |
| **13** | **WhatsApp** | **Native** | `apps/api/src/routes/whatsapp.routes.ts` — 400+ lines: register number, verify code, command dispatch (list/status/pause/resume/stop workflows), bridge-token auth | `WHATSAPP_BRIDGE_TOKEN` + phone/tenant map | production-ready | ✅ **Added this audit** | ✅ Real (was hidden from landing) |

### INTEGRATIONS_INFRA (9 tiles — unchanged count, Sentry clarified)

| # | Name | Adapter type | Code path | Maturity | Landing tile | Reality |
|---|---|---|---|---|---|---|
| 1 | Supabase | MCP (Official) + native auth integration | `MCP_PROVIDERS.SUPABASE` (MCP for agents) + `apps/web/src/lib/supabase-server.ts` (app auth) | beta (MCP) / production (auth) | ✅ Shown | ✅ Real |
| 2 | Sentry MCP | MCP (Official) | `MCP_PROVIDERS.SENTRY` — for agents to query Sentry projects. **NOT** the `@sentry/node` SDK | beta | ✅ Shown (**renamed this audit** — was "Sentry" which implied SDK) | ✅ Honest now |
| 3 | Brave Search | MCP (Anthropic) | `MCP_PROVIDERS.BRAVE_SEARCH` | beta | ✅ Shown | ✅ Real |
| 4 | PostgreSQL | MCP (Anthropic) | `MCP_PROVIDERS.POSTGRES` — read-only by default | beta | ✅ Shown | ✅ Real |
| 5 | Puppeteer | MCP (Anthropic) | `MCP_PROVIDERS.PUPPETEER` | beta | ✅ Shown | ✅ Real |
| 6 | Filesystem | MCP (Anthropic) | `MCP_PROVIDERS.FILESYSTEM` | beta | ✅ Shown | ✅ Real |
| 7 | Fetch | MCP (Anthropic) | `MCP_PROVIDERS.FETCH` | beta | ✅ Shown | ✅ Real |
| 8 | Memory | MCP (Anthropic) | `MCP_PROVIDERS.MEMORY` | beta | ✅ Shown | ✅ Real (separate from JAK's native memory system which uses pgvector) |
| 9 | Sequential Thinking | MCP (Anthropic) | `MCP_PROVIDERS.SEQUENTIAL_THINKING` | beta (experimental) | ✅ Shown | ✅ Real |

## Native non-MCP integrations NOT on landing

These are wired in the API but not surfaced as tiles (intentional or accidental):

| Name | Code path | Landing? | Why not shown |
|---|---|---|---|
| Gmail (IMAP/SMTP) | `packages/tools/src/adapters/gmail/` — real IMAP + SMTP adapter | Mentioned in copy ("Gmail via IMAP") but not as a tile | Gmail auth is **single-tenant env-var only** today (`GMAIL_EMAIL` + `GMAIL_APP_PASSWORD`); BYO OAuth pending. Credential service scaffolded at `apps/api/src/services/credential.service.ts`. Intentional to not show tile until BYO flow ships (I4 in founder list). |
| CalDAV | `packages/tools/src/adapters/calendar/` | Mentioned in copy ("Calendar via CalDAV") | Same as Gmail — single-tenant env until BYO OAuth |
| Vercel (AppDeployer) | `packages/agents/src/workers/app-deployer.agent.ts` uses Vercel API | Shown as "Deploy to Vercel" action, not an integration tile | Same — BYO Vercel OAuth pending |
| E2B (code sandbox) | `packages/tools/src/adapters/sandbox/` | Mentioned in copy ("Sandbox via E2B") | API-key-per-instance; intentional integrator-only tool |
| Playwright | `packages/tools/src/adapters/browser/` | Mentioned ("Browser via Playwright") | Behind `enableBrowserAutomation` tenant flag; not a third-party tile |

## Gotchas fixed this audit

1. **Sentry misrepresentation** — tile "Sentry" implied SDK-level observability. Renamed to "Sentry MCP" with explanatory comment. If you later install `@sentry/node`, you can re-add a second tile "Sentry SDK" or just rename back.
2. **Voice mock token** — `voice.routes.ts` used to return a fake `mock_token_${timestamp}` when `OPENAI_API_KEY` was unset. Now returns a 503 with actionable error message. A "Voice" integration is real — it just needs OPENAI_API_KEY.
3. **Paddle placeholder IDs** — route used `'pri_*_placeholder'` defaults. Any real Paddle webhook would never match these, so webhooks silently failed in `development-without-paddle-env` mode. Now plan map builds ONLY from real env vars; unmatched price IDs surface as clean "unknown plan" warnings.

## Remaining integration work (your I4)

**BYO Gmail + Vercel** — I shipped the credential service scaffold at `apps/api/src/services/credential.service.ts`. What's pending:

1. You register OAuth apps (Vercel + Google) and paste client IDs/secrets onto Render API
2. I implement `/integrations/gmail/connect` + `/integrations/vercel/connect` routes
3. I rewire `gmail/adapter-factory.ts` and Vercel-calling code to use `resolveCredentials(tenantId, 'GMAIL')`

When done: Gmail + Vercel move from "mentioned in copy" to proper INTEGRATIONS_CORE tiles (14 items), AND each tenant connects their own account. Ships at end-of-I4 in the founder-action-list.

## How to re-verify

```bash
# Every MCP_PROVIDERS entry has a buildConfig that accepts its credentialFields
pnpm --filter @jak-swarm/tests exec vitest run unit/tools/mcp-providers

# Landing page tile count matches INTEGRATIONS_CORE + INTEGRATIONS_INFRA length
pnpm -w run check:truth
```
