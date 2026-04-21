# Security Policy

JAK Swarm is an open-source autonomous multi-agent platform. Because agents execute real actions on behalf of users (sending email, making payments, editing documents), security reports are treated as high-priority.

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.** Instead:

- **Email**: `security@inbharat.ai` (preferred — encrypted disclosure welcomed)
- **GitHub private advisory**: <https://github.com/inbharatai/jak-swarm/security/advisories/new>

Please include:

1. A clear description of the vulnerability and its impact.
2. Reproduction steps (code snippet, curl command, or screenshot).
3. Affected version or commit SHA.
4. Whether you intend public disclosure, and on what timeline.

## Response SLA

| Severity      | Acknowledgement | First fix ETA | Public disclosure   |
|---------------|-----------------|---------------|---------------------|
| **Critical**  | <24 hours       | 72 hours      | After fix ships     |
| **High**      | <48 hours       | 14 days       | After fix ships     |
| **Medium**    | <5 business days| 30 days       | Coordinated         |
| **Low**       | <10 business days| Next release | Coordinated         |

Critical = RCE, auth bypass, privilege escalation, tenant isolation break, leaked secrets affecting multiple tenants.

## Supported versions

Security fixes are applied to:

- `main` branch — always.
- The most recent tagged release.

Older tagged releases receive fixes only if the vulnerability is rated Critical.

## Scope

**In scope:**

- `apps/api` (Fastify backend)
- `apps/web` (Next.js frontend)
- `packages/agents` (agent runtime)
- `packages/swarm` (orchestration)
- `packages/tools` (tool registry + sandbox)
- `packages/db` (Prisma schema + migrations)
- Official Docker images and Render/Vercel deployment manifests
- Official client SDK (`@jak-swarm/client`)

**Out of scope:**

- Third-party MCP servers we integrate with (report upstream)
- User-contributed skills that haven't passed the sandbox review
- Self-hosted deployments whose configuration deviates from documented defaults

## Known dual-use surfaces

Some features intentionally expose high-privilege actions because that's the point of an agent platform. These are documented separately in [docs/SECURITY-NOTES.md](docs/SECURITY-NOTES.md) and have dedicated guardrails:

- **`browser_evaluate_js`** — executes arbitrary JavaScript in a headless browser; gated behind `enableBrowserAutomation` tenant flag + approval.
- **`code_execute`** — runs untrusted code in an E2B sandbox; time-bounded, network-restricted, process-isolated.
- **Skill extension system** — user-submitted skills run in an isolated sandbox with a 30-second timeout before any human-review promotion.
- **Webhook signature verification** — Slack, Paddle, and Supabase webhooks use HMAC-SHA256 with `crypto.timingSafeEqual` + 5-minute replay window.

## What we'll do

- Acknowledge your report within the SLA above.
- Credit you in the release notes if you want, or keep your report anonymous.
- Not pursue legal action for good-faith research within scope.
- Communicate clearly about status, timeline, and the eventual fix.

## What we ask of you

- No data destruction, no DoS testing, no social engineering of our operators.
- Do not probe production tenants you don't own. Use the self-hosted setup for research.
- Give us reasonable time to fix before public disclosure.

## Cryptographic assumptions

- **JWT signing**: HS256 with a per-environment secret (`AUTH_SECRET`, ≥32 bytes). Supabase-issued tokens are verified against the Supabase JWKS.
- **Session tokens**: opaque, 256-bit entropy, stored server-side with tenant scoping.
- **Webhook HMAC**: SHA-256 with constant-time comparison.
- **Password hashing**: bcrypt, cost factor 12 (legacy endpoints only — Supabase is the primary auth path).
- **At-rest encryption**: delegated to Postgres / S3 / provider defaults; we do not currently field-level-encrypt tenant secrets in the DB — they are stored via Supabase Vault or as env vars on the compute plane.

## Secret rotation policy

- Production service-role keys are rotated at least every 90 days.
- Any key that appears in a commit, a log, a screenshot, or a Slack message is treated as leaked and rotated within 24 hours.
- Gitleaks runs on every PR in [CI](.github/workflows/ci.yml) to prevent regression.

## Responsible disclosure thanks

Researchers who report valid issues under this policy will be listed here with their consent.

*(none yet — be the first)*
