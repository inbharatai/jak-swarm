# Integration Maturity Matrix

This document is the source of truth for current integration depth. The landing page's
"22 Connectors" stat is the union of every brand surfaced in `apps/web/src/app/page.tsx`
(`INTEGRATIONS_CORE` + `INTEGRATIONS_INFRA`). The table below classifies every one of
those 22 — plus the adapters (Gmail, Google Calendar, CRM fallback) that ship in the
tools layer without a dedicated UI tile.

## Maturity Levels
- production-ready: Suitable for production use with current implementation and validation.
- beta: Usable in production with monitoring; behavior can vary by provider/API changes.
- partial: Exposed and usable in parts, but adapter depth or behavior is incomplete.
- placeholder: UI or config placeholder; not production-usable.

## Current Matrix

### External SaaS connectors (shown in `INTEGRATIONS_CORE`)

| Integration | Maturity | Runtime Path | Notes |
|---|---|---|---|
| Slack | production-ready | MCP + webhook verification in API | Signature verification and workflow bridging are implemented. |
| GitHub | beta | MCP provider tools + REST fallback | Depends on MCP server/tool availability and provider-side contracts. |
| Notion | beta | MCP provider tools | Depends on MCP server/tool availability and provider-side contracts. |
| Google Drive | partial | Auto-sync ingestion job (`company-connector-sync`) | Auto-syncs on a 5-minute schedule (`COMPANY_SYNC_PROVIDERS = GITHUB, GMAIL, GOOGLE_DRIVE`); no generic tool adapter surfaced, so on-demand agent calls are not supported. |
| HubSpot | partial | Provider entry exists; adapter depth varies | Validate tenant-specific flows before production dependency. |
| Salesforce | partial | Provider entry exists; adapter depth varies | Validate tenant-specific flows before production dependency. |
| WhatsApp | production-ready | Native bridge (not MCP) — `apps/api/src/routes/whatsapp.routes.ts` | Register / verify / send / receive via a bridge token; number verification is manual per tenant. |

### Infrastructure / MCP adapters and search backends

The first 9 rows below are the infrastructure adapters surfaced as UI tiles (`INTEGRATIONS_INFRA`). The 3 search backends (Serper, Tavily, DuckDuckGo) are `web_search` runtime options, not UI tiles — they're listed here for completeness and are excluded from the 9-adapter `INTEGRATIONS_INFRA` count in the summary.

| Integration | Maturity | Runtime Path | Notes |
|---|---|---|---|
| Sentry MCP | beta | Official Sentry MCP server (agents query Sentry projects via MCP at runtime) | Real via MCP; not a custom adapter. |
| Brave Search | beta | Web-search tool fallback | Used when `TAVILY_API_KEY` is absent; quality varies. |
| Serper (google.serper.dev) | config-dependent | `web_search` adapter (Wave 1 primary) | Google-graded organic + knowledge graph + answer box; requires `SERPER_API_KEY`. See [search-stack.md](./search-stack.md). |
| Tavily (api.tavily.com) | config-dependent | `web_search` adapter (Wave 1 secondary) | Research-oriented quality with answer synthesis; requires `TAVILY_API_KEY`. |
| DuckDuckGo HTML scrape | real (heuristic quality) | `web_search` adapter (Wave 1 free fallback) + 17 internal tools | Zero cost, no key, brittle to markup changes. **Not a branded product.** |
| PostgreSQL | production-ready | Prisma-backed core DB | Runtime dependency of the platform itself. |
| Puppeteer | production-ready | Browser automation adapter | Runs via Playwright; Puppeteer tile is a visual stand-in. |
| Filesystem | production-ready | `file_read`/`file_write` tools | Sandboxed to tenant workspaces. |
| Fetch | production-ready | `web_fetch` tool | Used for generic HTTP fetches. |
| Memory | production-ready | `memory_store`/`memory_retrieve` tools | Scoped-memory v2 persistence. |
| Sequential Thinking | beta | Planner uses this MCP pattern | Depends on MCP server availability. |

### Adapters not shown as UI tiles

| Integration | Maturity | Runtime Path | Notes |
|---|---|---|---|
| Gmail (email) | production-ready | Email adapter (IMAP/SMTP) | Real credential-backed adapter in tools layer. |
| Google Calendar | production-ready | CalDAV adapter | Real credential-backed adapter in tools layer. |
| CRM fallback (Prisma) | partial | Local fallback adapter | Not equivalent to full external CRM integration depth. |

## Summary counts (used by the landing page)

- **15 Connectors** = 7 external SaaS connectors (`INTEGRATIONS_CORE`, includes WhatsApp native bridge) + 8 infrastructure adapters (`INTEGRATIONS_INFRA`). Every connector has a real runtime path; there are no placeholder tiles. (+ 3 adapters — Gmail, Google Calendar, CRM fallback — ship without a UI tile.)
- **production-ready**: Slack, WhatsApp, Gmail, Google Calendar, PostgreSQL, Puppeteer, Filesystem, Fetch, Memory (9)
- **beta**: GitHub, Notion, Brave Search, Sequential Thinking, Sentry MCP (5)
- **partial**: Google Drive (auto-sync ingestion only), HubSpot, Salesforce, CRM fallback (4)

## Policy
- Do not label an integration as production-ready unless runtime behavior and adapter depth are validated.
- If provider behavior depends on external MCP server coverage, label as beta or partial.
- Every connector ships with a real runtime path (no placeholder tiles). If a connector cannot be wired, it is removed from the registry rather than shown as a placeholder.
- Keep the landing page numeric stat consistent with the count above; `pnpm check:truth` fails on drift.
