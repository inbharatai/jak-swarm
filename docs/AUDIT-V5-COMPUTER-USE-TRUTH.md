# AUDIT V5 — Computer-Use / Direct Action Truth Audit

**Auditor role:** Principal AI Systems Architect, Security Auditor, Product Truth Reviewer  
**Date:** 2025-07-16  
**Scope:** Evidence-based audit of JAK's "computer-use / direct action" capability vs. Claude's computer interaction feature  
**Methodology:** Every claim traced to source code. Zero inference from naming. Only verified code counts.

---

## Blunt One-Line Truth

**JAK has real, production-grade browser automation via Playwright — but it is NOT "computer use" in the Claude/Anthropic sense, has critical unenforced security gates, and two conflicting execution paths that undermine its own safety model.**

---

## 1. Executive Truth Summary

JAK Swarm ships 18 real Playwright-powered browser tools. These are not mocks — `PlaywrightEngine` is a well-built singleton that launches real Chromium, maintains a persistent browser profile, navigates pages, fills forms, clicks buttons, takes screenshots, and feeds them to GPT-4o for vision analysis. This is genuine, functional browser automation.

**However:**

- **It is not "computer use."** There is zero desktop/OS-level interaction — no pyautogui, robotjs, nutjs, xdotool, or any framework for clicking outside a browser window, controlling system dialogs, or interacting with non-web applications.
- **The primary security gate (`enableBrowserAutomation`) is never enforced.** The flag exists in Prisma schema and is documented in the threat model, but no execution code reads it. Every tenant can execute browser tools regardless of this setting.
- **Industry pack `restrictedTools` arrays are decorative.** Multiple packs list `ToolCategory.BROWSER` as restricted, but no execution code consumes these restrictions.
- **`browser_evaluate_js` allows arbitrary JavaScript injection** in the page context with `requiresApproval: false`.
- **Two conflicting execution paths exist:** The BrowserAgent enforces domain allowlists; the direct tool registry path does not. Any agent can bypass BrowserAgent's safety by calling `browser_navigate` directly.

---

## 2. Capability Scorecard

| # | Capability | Claude Computer Use | JAK Swarm | Evidence |
|---|-----------|-------------------|-----------|----------|
| 1 | Click elements | ✅ Pixel-level, any app | ✅ CSS selector, browser only | `playwrightEngine.clickElement()` — real |
| 2 | Type text | ✅ OS keyboard, any app | ✅ Browser keyboard only | `page.keyboard.type()` with 50ms delay — real |
| 3 | Navigate URLs | ✅ Any browser | ✅ Chromium via Playwright | `playwrightEngine.navigate(url)` — real |
| 4 | Read page state | ✅ Pixel/OCR any screen | ✅ DOM extraction only | `page.evaluate()` + `getPageContent()` — real |
| 5 | Screenshot + Vision | ✅ Full screen capture + vision | ⚠️ Browser viewport only + GPT-4o | `page.screenshot()` → OpenAI vision — real but browser-scoped |
| 6 | Multi-step sequences | ✅ Continuous observation loop | ⚠️ BrowserAgent tool loop only | `executeWithTools()` loop — real but agent-path only |
| 7 | Cross-application | ✅ Any desktop application | ❌ None | No desktop automation code found |
| 8 | Desktop/OS control | ✅ Full mouse/keyboard/screen | ❌ None | Zero desktop automation libraries |
| 9 | System dialogs | ✅ File pickers, alerts, OS prompts | ❌ None | No OS-level interaction |
| 10 | File operations | ✅ Via desktop automation | ⚠️ Upload via Playwright only | `browser_upload_file` — `setInputFiles()` — real |
| 11 | Form filling | ✅ Any input, any app | ✅ Web forms via selectors | `playwrightEngine.fillForm()` — real |
| 12 | Approval gates | N/A (human-in-the-loop by default) | ⚠️ Task-level only, not tool-level | `task.requiresApproval` checked, not `tool.requiresApproval` |
| 13 | Tenant permissions | N/A | ❌ Not enforced | `enableBrowserAutomation` — schema only, zero runtime checks |
| 14 | Domain restrictions | N/A | ⚠️ BrowserAgent path only | `allowedDomains` enforced in BrowserAgent, bypassed in direct tools |
| 15 | Audit trail | ✅ Screenshots as evidence | ⚠️ Agent traces recorded | `recordTrace()` in BrowserAgent — real |
| 16 | Arbitrary JS execution | ❌ Not exposed | ⚠️ Unrestricted, no approval | `browser_evaluate_js` — `page.evaluate(code)` with no gate |
| 17 | Error recovery | ✅ Visual re-assessment | ⚠️ Retry loop (max 3) | `afterVerifier` retry loop — real but blind (no visual re-assess) |
| 18 | PDF generation | N/A | ✅ Real | `page.pdf()` — real Playwright |

**Score: 9/18 real capabilities, 6 partial, 3 completely absent**

---

## 3. Architecture Trace

### Execution Path A: Via Swarm Graph → BrowserAgent (Safe Path)

```
User prompt
  → ChatWorkspace (SSE)
  → POST /api/workflows
  → SwarmExecutionService.execute()
  → SwarmGraph.run()
    → commanderNode → plannerNode → routerNode
    → guardrailNode
      → if task.requiresApproval → approvalNode
    → workerNode
      → createWorkerAgent(AgentRole.WORKER_BROWSER)
      → BrowserAgent.execute(task)
        → Validates allowedDomains ✅
        → Blocks write actions without approval ✅
        → executeWithTools() → OpenAI tool-calling loop
        → recordTrace() for audit ✅
```

**Source files verified:**
- `packages/swarm/src/graph/swarm-graph.ts` — Node routing, conditional edges
- `packages/swarm/src/graph/nodes/worker-node.ts` — Agent dispatch, line 271: `allowedDomains: []`
- `packages/agents/src/workers/browser.agent.ts` — Domain validation, approval enforcement

**Critical Issue:** `allowedDomains` is hardcoded to `[]` at `worker-node.ts:271`. The BrowserAgent validates against this empty list, meaning it would either block ALL or allow ALL domains depending on how the empty-set check works.

### Execution Path B: Direct Tool Registry (Unsafe Path)

```
Any agent (via tool-calling loop)
  → toolRegistry.execute('browser_navigate', { url })
  → PlaywrightEngine.navigate(url)
    → NO domain validation ❌
    → NO tenant permission check ❌
    → NO approval gate ❌
```

**Source files verified:**
- `packages/tools/src/registry/tool-registry.ts` — No category filtering, no tenant checks
- `packages/tools/src/registry/tenant-tool-registry.ts` — `isAllowed()` only checks `metadata.provider`; built-in tools (including all browser tools) have no provider → always allowed
- `packages/tools/src/builtin/index.ts:957` — `browser_navigate` executor calls `playwrightEngine.navigate(url)` directly

**Any agent that uses the tool-calling loop can invoke browser tools directly without going through BrowserAgent's safety checks.**

### PlaywrightEngine (Verified Real)

```typescript
// packages/tools/src/adapters/browser/playwright-engine.ts
class PlaywrightEngine {
  chromium.launch()                          // Real Chromium
  launchPersistentContext('~/.jak-swarm/browser-profile')  // Persistent session
  page.goto(url)                             // Real navigation
  page.fill(selector, value)                 // Real form filling
  page.locator(selector).click()             // Real clicking
  page.screenshot({ type: 'png' })           // Real screenshots
  page.keyboard.type(text, { delay: 50 })    // Real typing
  page.pdf()                                 // Real PDF generation
}
```

Config: 1280×800 viewport, Chrome 120 UA, 30s default timeout, headless by default.

---

## 4. Gap Analysis vs. Claude Computer Use

| Dimension | Claude Computer Use | JAK Swarm | Gap Severity |
|-----------|-------------------|-----------|-------------|
| **Interaction surface** | Entire OS desktop | Browser viewport only | 🔴 FUNDAMENTAL |
| **Input method** | Pixel coordinates (x,y) | CSS selectors | 🟡 MEDIUM |
| **Observation model** | Continuous screenshot loop | Per-tool invocation | 🟡 MEDIUM |
| **Application scope** | Any desktop app, terminal, file browser | Web pages only | 🔴 FUNDAMENTAL |
| **Vision integration** | Native multimodal (Claude sees screenshots) | GPT-4o via API call (single tool) | 🟡 MEDIUM |
| **Autonomy model** | Human confirms at key points, agent re-plans based on visual state | Task-level approval, no visual re-planning in tool path | 🟡 MEDIUM |
| **Error handling** | Visual verification (did click land correctly?) | Retry loop (max 3) without visual feedback | 🟡 MEDIUM |
| **State persistence** | Single session, stateful | Persistent browser profile at `~/.jak-swarm/browser-profile` | 🟢 COMPARABLE |
| **Multi-tab support** | N/A (screenshot-based) | Real Playwright tab management | 🟢 JAK ADVANTAGE |
| **Structured extraction** | Must parse screenshots | DOM access, CSS selectors, JS evaluation | 🟢 JAK ADVANTAGE |

### What JAK Would Need to Match Claude Computer Use

1. **Desktop automation layer** — robotjs, nut.js, or similar for OS-level mouse/keyboard/screen
2. **Screen capture loop** — Continuous screenshot → analyze → act cycle, not per-tool
3. **Pixel-based interaction** — Click by (x,y) coordinates, not CSS selectors
4. **Vision-first architecture** — Agent sees visual state, not DOM state
5. **Cross-app capability** — Interact with terminal, file browser, desktop apps, system dialogs

### What JAK Does Better Than Claude Computer Use

1. **Structured data extraction** — DOM access is more reliable than OCR
2. **Form filling** — CSS selector `page.fill()` is faster and more reliable than pixel-based typing
3. **Multi-tab orchestration** — Real browser tab management
4. **PDF generation** — Native Playwright PDF export
5. **Persistent sessions** — Browser profile persists across workflow runs

**Bottom line:** JAK and Claude computer-use solve fundamentally different problems. Claude controls a desktop; JAK automates a browser. These are complementary, not competitive.

---

## 5. Security & Misuse Audit

### 🔴 CRITICAL: `enableBrowserAutomation` Flag Not Enforced

**Documented claim** (security-threat-model.md, line 93):
> "Tenant must explicitly enable it (`enableBrowserAutomation: true`) and is off by default."

**Code reality:**
- `packages/db/prisma/schema.prisma:23` — `enableBrowserAutomation Boolean @default(false)` ✅ defined
- `packages/shared/src/types/tenant.ts:21` — `enableBrowserAutomation: boolean` ✅ typed
- `packages/shared/src/schemas/tenant.schema.ts:11` — `z.boolean().default(false)` ✅ validated

**But no execution code reads this flag:**
- `packages/tools/src/registry/tool-registry.ts` — No mention
- `packages/tools/src/registry/tenant-tool-registry.ts` — `isAllowed()` checks `provider` only
- `packages/swarm/src/graph/nodes/*` — No mention
- `apps/api/src/**` — No conditional check found

**Impact:** Any tenant can execute all 18 browser tools regardless of `enableBrowserAutomation` setting.

### 🔴 CRITICAL: `browser_evaluate_js` — Arbitrary JS with No Gate

```typescript
// packages/tools/src/builtin/index.ts:1476-1506
{
  name: 'browser_evaluate_js',
  requiresApproval: false,   // ← No approval required
  riskClass: ToolRiskClass.WRITE,
  // Executor:
  const result = await page.evaluate(code);  // ← Arbitrary JS injection
}
```

Any agent can execute arbitrary JavaScript in the browser context. No approval gate. No content filtering. This is a direct code injection vector that could:
- Exfiltrate cookies/tokens from authenticated sessions
- Modify page state to phish users
- Execute XSS payloads

### 🔴 CRITICAL: Industry Pack `restrictedTools` Not Enforced

8 of 11 industry packs restrict `ToolCategory.BROWSER`:
- Finance: `restrictedTools: [ToolCategory.WEBHOOK, ToolCategory.BROWSER, ToolCategory.CRM]`
- Legal: `restrictedTools: [ToolCategory.WEBHOOK, ToolCategory.BROWSER, ToolCategory.CRM]`
- Education, Insurance, Customer Support, Hospitality, Logistics, Retail: all restrict BROWSER

**But no enforcement exists.** Searched all execution code — zero references to `restrictedTools` in `packages/swarm/`, `packages/tools/`, or `apps/api/`.

### 🟡 HIGH: `allowedDomains` Hardcoded Empty

```typescript
// packages/swarm/src/graph/nodes/worker-node.ts:271
case AgentRole.WORKER_BROWSER:
  return {
    actions: [{ type: 'EXTRACT' as const, selector: 'body' }],
    allowedDomains: [],  // ← Always empty
  };
```

The BrowserAgent validates domains correctly, but `workerNode` always passes an empty array. Either:
- Empty array = block everything (safe but useless)
- Empty array = allow everything (unsafe)

Either way, this is a bug. The tenant's configured `allowedDomains` from the schema is never wired to the execution path.

### 🟡 HIGH: Tool-Level `requiresApproval` Not Enforced

Tool metadata like `browser_click: { requiresApproval: true }` is defined but never checked at execution time. The approval gate in `swarm-graph.ts:50` checks `task.requiresApproval` — a property set by the planner, not derived from tool metadata.

### 🟡 MEDIUM: Two Execution Paths with Different Security

| Check | BrowserAgent Path | Direct Tool Path |
|-------|------------------|-----------------|
| Domain allowlist | ✅ Validated | ❌ Not checked |
| Write action approval | ✅ Blocks without approval | ❌ Not checked |
| Screenshot audit trail | ✅ Before/after writes | ❌ Not automatic |
| Tenant permission | ❌ Not checked | ❌ Not checked |

### Security Summary Table

| Finding | Severity | Status | File |
|---------|----------|--------|------|
| `enableBrowserAutomation` not enforced | 🔴 CRITICAL | Schema exists, runtime check missing | tenant-tool-registry.ts |
| `browser_evaluate_js` no approval gate | 🔴 CRITICAL | `requiresApproval: false` on arbitrary JS exec | builtin/index.ts:1476 |
| Industry pack restrictions decorative | 🔴 CRITICAL | Data defined, never consumed | swarm/src/** (absent) |
| `allowedDomains` hardcoded `[]` | 🟡 HIGH | BrowserAgent validates but gets empty list | worker-node.ts:271 |
| Tool-level approval not enforced | 🟡 HIGH | Task-level only, tool metadata ignored | swarm-graph.ts:50 |
| Dual execution path security mismatch | 🟡 MEDIUM | BrowserAgent safe, direct tools unsafe | tool-registry.ts |

---

## 6. Truthfulness Audit

### Landing Page Claims (`apps/web/src/app/page.tsx`)

| Claim | Accurate? | Evidence |
|-------|-----------|---------|
| "Your Entire Company, Automated" | 🟡 Overstatement | Browser automation is real, but "entire company" implies desktop/cross-app which doesn't exist |
| "all autonomous" | 🟡 Misleading | 12 tools require approval; autonomy is partial by design |
| "Real integrations, not demos" | ✅ Accurate for browser tools | Playwright tools are genuinely functional, not mocked |
| "Navigate, click, fill forms, screenshot, PDF, cookies, tabs" | ✅ Accurate | All verified as real Playwright calls |
| "56 Production Tools" | ⚠️ Unverified count | Did not count all registered tools; some may be stubs |
| "20 Browser Tools" | ⚠️ Plausible | Found 18 browser tools; 20 is close but not verified exactly |
| "Meet your autonomous workforce" | 🟡 Overstatement | Agents are real but many require human approval |

### README Claims

| Claim | Accurate? | Evidence |
|-------|-----------|---------|
| "Autonomous Multi-Agent AI Platform" | ✅ Fair description | Multi-agent swarm graph is real and functional |
| "20 Browser Tools (Playwright)" | ⚠️ See above | Found 18, not 20 |

### Security Threat Model Claims (`docs/security-threat-model.md`)

| Claim | Accurate? | Evidence |
|-------|-----------|---------|
| "Tenant must explicitly enable browser automation" | ❌ FALSE | Flag exists in schema but is never checked at runtime |
| "Domain allowlist" | ⚠️ Partially true | BrowserAgent checks it, but direct tool path doesn't; also hardcoded `[]` |
| "SSRF prevention" | ⚠️ Unverified | No explicit SSRF filter found in browser tool code |
| "No credential storage" | ⚠️ Unverified | Persistent browser profile at `~/.jak-swarm/browser-profile` may retain cookies |
| "Approval gates for write actions" | ⚠️ Partially true | BrowserAgent enforces this; direct tool path does not |
| "Screenshot audit trail" | ⚠️ Partially true | BrowserAgent records traces, direct tools don't auto-screenshot |

### What the Product Actually Is (Truthful Description)

> JAK Swarm is a multi-agent orchestration platform with real Playwright-powered browser automation. It can navigate web pages, fill forms, click elements, take screenshots, and extract data using 18 production browser tools. It does NOT provide desktop-level computer control. Browser tools are accessible to all tenants regardless of permissions settings, and several documented security controls are not yet implemented in code.

---

## 7. Fix Plan

### Phase 1 — Critical Security (1-2 days)

**1. Enforce `enableBrowserAutomation` in TenantToolRegistry**

```typescript
// packages/tools/src/registry/tenant-tool-registry.ts
export class TenantToolRegistry {
  private readonly browserAutomationEnabled: boolean;

  constructor(tenantId: string, connectedProviders: string[], options?: {
    browserAutomationEnabled?: boolean;
  }) {
    this.browserAutomationEnabled = options?.browserAutomationEnabled ?? false;
  }

  private isAllowed(metadata: ToolMetadata): boolean {
    // Block browser tools if tenant hasn't enabled browser automation
    if (metadata.category === ToolCategory.BROWSER && !this.browserAutomationEnabled) {
      return false;
    }
    if (!metadata.provider) return true;
    return this.allowedProviders.has(metadata.provider.toLowerCase());
  }
}
```

**2. Add approval gate to `browser_evaluate_js`**

```typescript
// Change in packages/tools/src/builtin/index.ts:1487
requiresApproval: true,  // Was: false
```

**3. Enforce tool-level `requiresApproval` in execution pipeline**

Add a check in `workerNode` or tool registry `execute()` that reads `metadata.requiresApproval` and blocks execution if no approval has been recorded.

### Phase 2 — Industry Pack Enforcement (1-2 days)

**4. Wire `restrictedTools` into TenantToolRegistry**

```typescript
constructor(tenantId: string, connectedProviders: string[], options?: {
  browserAutomationEnabled?: boolean;
  restrictedCategories?: ToolCategory[];
}) {
  this.restrictedCategories = new Set(options?.restrictedCategories ?? []);
}

private isAllowed(metadata: ToolMetadata): boolean {
  if (this.restrictedCategories.has(metadata.category)) return false;
  // ... existing checks
}
```

**5. Wire tenant `allowedDomains` into worker-node browser input**

```typescript
// packages/swarm/src/graph/nodes/worker-node.ts:271
case AgentRole.WORKER_BROWSER:
  return {
    actions: [{ type: 'EXTRACT' as const, selector: 'body' }],
    allowedDomains: state.tenantConfig?.allowedDomains ?? [],  // From tenant config
  };
```

### Phase 3 — Unified Safety Layer (3-5 days)

**6. Add domain validation to direct tool path**

The `browser_navigate` executor should validate URLs against the tenant's `allowedDomains` from `ToolExecutionContext`.

**7. Add automatic screenshot audit trail for direct tool calls**

Browser write tools (`browser_click`, `browser_fill_form`, `browser_type_text`) should auto-capture before/after screenshots regardless of execution path.

**8. Implement SSRF protection in PlaywrightEngine**

Block navigation to private IPs (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x, fd00::/8) in the navigate method.

### Phase 4 — Accuracy Corrections (1 day)

**9. Fix marketing copy**

- Replace "all autonomous" with "with human-in-the-loop approval for sensitive actions"
- Verify "56 Production Tools" and "20 Browser Tools" counts against actual registry
- Add explicit disclaimer: "Browser automation only — not desktop-level computer control"

**10. Fix security-threat-model.md**

- Mark `enableBrowserAutomation` enforcement as TODO until Phase 1 ships
- Document the dual execution path issue
- Remove claims about implemented controls that don't exist in code

---

## 8. Final Verdict

### Classification

**JAK Swarm has: Real Browser Automation (Playwright)**  
**JAK Swarm does NOT have: Computer Use (in the Claude/Anthropic sense)**

These are fundamentally different capabilities:

- **Browser automation** = controlling a web browser via API (Playwright, Selenium, Puppeteer)
- **Computer use** = controlling an entire desktop via screen capture + pixel interaction

JAK's browser automation is **genuinely well-built**. The PlaywrightEngine singleton, persistent context, 18 registered tools, and GPT-4o vision integration represent real engineering. This is not a demo or a mock.

But it is categorically different from Claude's computer-use, which operates at the OS level — seeing the screen as pixels, clicking coordinates, typing via virtual keyboard into any application. JAK cannot do any of that.

### Honest Rating

| Dimension | Rating |
|-----------|--------|
| Browser automation quality | ⭐⭐⭐⭐ (4/5) — Real, functional, well-architected |
| Desktop/computer control | ⭐ (0/5) — Does not exist |
| Security enforcement | ⭐⭐ (2/5) — Good design, poor implementation |
| Marketing truthfulness | ⭐⭐⭐ (3/5) — Says "browser", not "computer use", but overclaims autonomy |
| Production readiness | ⭐⭐⭐ (3/5) — Tools work but security gates must be enforced first |

---

## Top 5 Blockers (Preventing "Ship It" Status)

1. **`enableBrowserAutomation` not enforced** — Any tenant gets browser tools regardless of setting
2. **`browser_evaluate_js` is an unrestricted JS injection vector** — `requiresApproval: false` on `page.evaluate()`
3. **Industry pack `restrictedTools` is decorative** — 8/11 packs restrict BROWSER but nothing reads it
4. **`allowedDomains` hardcoded empty** — Tenant domain config never reaches browser tools
5. **Dual execution path** — BrowserAgent's safety checks are bypassable via direct tool calls

## Top 5 Highest-Value Fixes

1. **Enforce `enableBrowserAutomation` in `TenantToolRegistry.isAllowed()`** — 20 lines, blocks the biggest gap
2. **Set `requiresApproval: true` on `browser_evaluate_js`** — 1 line change, closes injection vector
3. **Wire `restrictedCategories` from industry packs into TenantToolRegistry** — 15 lines, activates existing safety data
4. **Pass tenant `allowedDomains` to worker-node browser input** — 5 lines, activates domain filtering
5. **Add domain validation to direct browser tool executors** — 30 lines, unifies safety across both paths

---

*Audit V5 complete. No code was modified — this is a read-only assessment. All findings cite specific files and line numbers from the codebase as of 2025-07-16.*
