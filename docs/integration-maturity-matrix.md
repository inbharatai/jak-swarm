# Integration Maturity Matrix

This document is the source of truth for current integration depth.

## Maturity Levels
- production-ready: Suitable for production use with current implementation and validation.
- beta: Usable in production with monitoring; behavior can vary by provider/API changes.
- partial: Exposed and usable in parts, but adapter depth or behavior is incomplete.
- placeholder: UI or config placeholder; not production-usable.

## Current Matrix

| Integration | Maturity | Runtime Path | Notes |
|---|---|---|---|
| Slack | production-ready | MCP + webhook verification in API | Signature verification and workflow bridging are implemented. |
| GitHub | beta | MCP provider tools | Depends on MCP server/tool availability and provider-side contracts. |
| Notion | beta | MCP provider tools | Depends on MCP server/tool availability and provider-side contracts. |
| HubSpot | partial | Provider entry exists; adapter depth varies | Validate tenant-specific flows before production dependency. |
| Salesforce | partial | Provider entry exists; adapter depth varies | Validate tenant-specific flows before production dependency. |
| Gmail (email) | production-ready | Email adapter (IMAP/SMTP) | Real credential-backed adapter in tools layer. |
| Google Calendar | production-ready | CalDAV adapter | Real credential-backed adapter in tools layer. |
| CRM fallback (Prisma) | partial | Local fallback adapter | Not equivalent to full external CRM integration depth. |

## Policy
- Do not label an integration as production-ready unless runtime behavior and adapter depth are validated.
- If provider behavior depends on external MCP server coverage, label as beta or partial.
- Keep UI/API labels aligned with this matrix.
