# Integration Maturity Matrix

This document is the source of truth for current integration depth. The landing page's
"21 Connectors" stat is the union of every brand surfaced in `apps/web/src/app/page.tsx`
(`INTEGRATIONS_CORE` + `INTEGRATIONS_INFRA`). The table below classifies every one of
those 21 — plus the adapters (Gmail, Google Calendar, CRM fallback) that ship in the
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
| Google Drive | placeholder | UI tile only | No runtime adapter wired; do not rely on this for production. |
| Linear | placeholder | UI tile only | No runtime adapter wired. |
| HubSpot | partial | Provider entry exists; adapter depth varies | Validate tenant-specific flows before production dependency. |
| Stripe | placeholder | UI tile only | Billing flows use Stripe, but no generic tenant-connector is wired. |
| Salesforce | partial | Provider entry exists; adapter depth varies | Validate tenant-specific flows before production dependency. |
| Airtable | placeholder | UI tile only | No runtime adapter wired. |
| ClickUp | placeholder | UI tile only | No runtime adapter wired. |
| SendGrid | placeholder | UI tile only | Outbound email ships via Gmail IMAP/SMTP, not SendGrid. |
| Discord | placeholder | UI tile only | No runtime adapter wired. |

### Infrastructure / MCP adapters (shown in `INTEGRATIONS_INFRA`)

| Integration | Maturity | Runtime Path | Notes |
|---|---|---|---|
| Supabase | placeholder | UI tile only | No runtime adapter; platform uses Postgres directly. |
| Sentry | placeholder | UI tile only | No runtime adapter wired. |
| Brave Search | beta | Web-search tool fallback | Used when `TAVILY_API_KEY` is absent; quality varies. |
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

- **21 Connectors** = 12 external SaaS connectors (`INTEGRATIONS_CORE`) + 9 infrastructure adapters (`INTEGRATIONS_INFRA`). Most are UI tiles pending real adapters; only the subset marked `production-ready` or `beta` has a runtime path today.
- **production-ready**: Slack, Gmail, Google Calendar, PostgreSQL, Puppeteer, Filesystem, Fetch, Memory (8)
- **beta**: GitHub, Notion, Brave Search, Sequential Thinking (4)
- **partial**: HubSpot, Salesforce, CRM fallback (3)
- **placeholder**: Google Drive, Linear, Stripe, Airtable, ClickUp, SendGrid, Discord, Supabase, Sentry (9)

## Policy
- Do not label an integration as production-ready unless runtime behavior and adapter depth are validated.
- If provider behavior depends on external MCP server coverage, label as beta or partial.
- UI tiles that lack a runtime adapter MUST be labeled `placeholder` here.
- Keep the landing page's numeric stat consistent with the count above; when a connector moves out of `placeholder`, update both this matrix and the corresponding adapter/tool.
