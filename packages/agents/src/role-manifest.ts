import { AgentRole } from '@jak-swarm/shared';

/**
 * Role maturity — honest classification of each agent role's depth.
 *
 * - world_class    : operator-grade prompt + structured output + behavioral tests.
 *                    Rejecting LLM fabrication and domain-specific reasoning present.
 * - upgraded       : recently expanded to expert-level; structured output schema
 *                    extended; behavioral tests may be partial.
 * - strong         : reasonable prompt + structured output; not bleeding-edge
 *                    but functional for production use in its domain.
 * - moderate       : prompt is reasonable but not deeply specialized; output
 *                    shape is correct but not enriched with expert fields.
 * - shallow        : thin prompt or generic persona; use with caution.
 * - experimental   : incomplete, fragile, or capability-gated (browser
 *                    automation against logged-in sites, unverified
 *                    integrations). Opt-in only.
 */
export type RoleMaturity =
  | 'world_class'
  | 'upgraded'
  | 'strong'
  | 'moderate'
  | 'shallow'
  | 'experimental';

export interface RoleManifestEntry {
  role: AgentRole;
  displayName: string;
  maturity: RoleMaturity;
  /** What this role actually does well. */
  strengths: string[];
  /** Honest limitations the caller should know. */
  limitations?: string[];
  /** Optional link to the file that implements the role. */
  implementation?: string;
}

/**
 * Source-of-truth classification. Updated when role prompts change.
 * The truth-check script asserts that (a) every AgentRole has an entry,
 * and (b) no entry claims a higher maturity than the code actually supports.
 */
export const ROLE_MANIFEST: Record<AgentRole, RoleManifestEntry> = {
  // ─── Orchestrators (world-class by design — they don't do domain work) ─
  [AgentRole.COMMANDER]: {
    role: AgentRole.COMMANDER,
    displayName: 'Commander',
    maturity: 'world_class',
    strengths: ['Role-mode routing', 'Intent classification', 'Multi-role delegation'],
    implementation: 'packages/agents/src/roles/commander.agent.ts',
  },
  [AgentRole.PLANNER]: {
    role: AgentRole.PLANNER,
    displayName: 'Planner',
    maturity: 'world_class',
    strengths: ['DAG planning', 'Dependency resolution', 'Task decomposition'],
    implementation: 'packages/agents/src/roles/planner.agent.ts',
  },
  [AgentRole.ROUTER]: {
    role: AgentRole.ROUTER,
    displayName: 'Router',
    maturity: 'world_class',
    strengths: ['Role selection', 'Load balancing across worker pool'],
    implementation: 'packages/agents/src/roles/router.agent.ts',
  },
  [AgentRole.VERIFIER]: {
    role: AgentRole.VERIFIER,
    displayName: 'Verifier',
    maturity: 'world_class',
    strengths: ['Multi-axis verification', 'Schema checking', 'Hallucination detection'],
    implementation: 'packages/agents/src/roles/verifier.agent.ts',
  },
  [AgentRole.GUARDRAIL]: {
    role: AgentRole.GUARDRAIL,
    displayName: 'Guardrail',
    maturity: 'world_class',
    strengths: ['Policy enforcement', 'PII detection', 'Injection defense'],
    implementation: 'packages/agents/src/roles/guardrail.agent.ts',
  },
  [AgentRole.APPROVAL]: {
    role: AgentRole.APPROVAL,
    displayName: 'Approval',
    maturity: 'world_class',
    strengths: ['Risk-stratified gating', 'Audit-trail approvals'],
    implementation: 'packages/agents/src/roles/approval.agent.ts',
  },

  // ─── Executive tier (CEO/CMO/CTO etc — already strong) ────────────────
  [AgentRole.WORKER_STRATEGIST]: {
    role: AgentRole.WORKER_STRATEGIST,
    displayName: 'Strategist (CEO)',
    maturity: 'world_class',
    strengths: ['Fortune 500 CEO persona', 'Strategic frameworks', 'Second-order thinking'],
    implementation: 'packages/agents/src/workers/strategist.agent.ts',
  },
  [AgentRole.WORKER_MARKETING]: {
    role: AgentRole.WORKER_MARKETING,
    displayName: 'Marketing (CMO)',
    maturity: 'world_class',
    strengths: ['CMO-grade prompt', 'Revenue attribution', 'Campaign design', '9 dedicated tools'],
    implementation: 'packages/agents/src/workers/marketing.agent.ts',
  },
  [AgentRole.WORKER_TECHNICAL]: {
    role: AgentRole.WORKER_TECHNICAL,
    displayName: 'Technical (CTO)',
    maturity: 'world_class',
    strengths: ['Principal engineer persona', 'FAANG-scale systems judgment', 'Architecture trade-offs'],
    implementation: 'packages/agents/src/workers/technical.agent.ts',
  },
  [AgentRole.WORKER_FINANCE]: {
    role: AgentRole.WORKER_FINANCE,
    displayName: 'Finance (CFO)',
    maturity: 'world_class',
    strengths: ['CFO-grade analysis', 'Every number cited or labeled estimate', 'PE-operator thinking'],
    implementation: 'packages/agents/src/workers/finance.agent.ts',
  },
  [AgentRole.WORKER_HR]: {
    role: AgentRole.WORKER_HR,
    displayName: 'HR (People Ops)',
    maturity: 'strong',
    strengths: ['VP People Ops persona', 'Culture + policy balance'],
    implementation: 'packages/agents/src/workers/hr.agent.ts',
  },
  [AgentRole.WORKER_GROWTH]: {
    role: AgentRole.WORKER_GROWTH,
    displayName: 'Growth',
    maturity: 'world_class',
    strengths: ['466-line specialized prompt', 'Lead-gen + SEO + outreach'],
    implementation: 'packages/agents/src/workers/growth.agent.ts',
  },

  // ─── Upgraded (Session 8 + follow-ons) ────────────────────────────────
  [AgentRole.WORKER_EMAIL]: {
    role: AgentRole.WORKER_EMAIL,
    displayName: 'Email',
    maturity: 'upgraded',
    strengths: [
      'Deliverability advisory (SPF/DKIM/DMARC, spam triggers)',
      'A/B subject variants with hypothesis',
      'Send-time suggestion',
      'CAN-SPAM / GDPR compliance notes',
    ],
    implementation: 'packages/agents/src/workers/email.agent.ts',
  },
  [AgentRole.WORKER_CRM]: {
    role: AgentRole.WORKER_CRM,
    displayName: 'CRM',
    maturity: 'upgraded',
    strengths: [
      'Deal-health scoring rubric',
      'BANT / MEDDIC lead qualification',
      'Next-best-action guidance',
      'Duplicate detection',
    ],
    implementation: 'packages/agents/src/workers/crm.agent.ts',
  },
  [AgentRole.WORKER_RESEARCH]: {
    role: AgentRole.WORKER_RESEARCH,
    displayName: 'Research',
    maturity: 'upgraded',
    strengths: [
      'Source-quality tiers (primary / secondary / unverified)',
      'Freshness classification',
      'Disagreement surfacing with analyst view',
      'Citation-to-claim mapping',
    ],
    implementation: 'packages/agents/src/workers/research.agent.ts',
  },
  [AgentRole.WORKER_CALENDAR]: {
    role: AgentRole.WORKER_CALENDAR,
    displayName: 'Calendar',
    maturity: 'upgraded',
    strengths: [
      'Meeting-type classification drives duration + buffer',
      'Hard vs soft conflict split',
      'Slot quality scoring (0-100)',
      'DST awareness',
    ],
    implementation: 'packages/agents/src/workers/calendar.agent.ts',
  },
  [AgentRole.WORKER_DOCUMENT]: {
    role: AgentRole.WORKER_DOCUMENT,
    displayName: 'Document',
    maturity: 'upgraded',
    strengths: [
      'Forensic extraction (every field carries sourceText)',
      'ISO 8601 + currency code discipline',
      'Red-flag detection',
    ],
    implementation: 'packages/agents/src/workers/document.agent.ts',
  },
  [AgentRole.WORKER_SUPPORT]: {
    role: AgentRole.WORKER_SUPPORT,
    displayName: 'Support',
    maturity: 'upgraded',
    strengths: [
      '5-level urgency rubric',
      'Explicit escalation triggers (legal/regulator/security)',
      'Deflection quality + no-fake-promises rules',
    ],
    implementation: 'packages/agents/src/workers/support.agent.ts',
  },
  [AgentRole.WORKER_OPS]: {
    role: AgentRole.WORKER_OPS,
    displayName: 'Ops / SRE',
    maturity: 'upgraded',
    strengths: [
      'Severity triage (p0-p4)',
      'Blast-radius + cascade detection',
      'Written rollback plan for every destructive action',
      'Five-whys root cause chain',
    ],
    implementation: 'packages/agents/src/workers/ops.agent.ts',
  },
  [AgentRole.WORKER_VOICE]: {
    role: AgentRole.WORKER_VOICE,
    displayName: 'Voice / Call Analysis',
    maturity: 'upgraded',
    strengths: [
      'Decisions separated from action items',
      'Speaker stats (talk-time / questions / interruptions)',
      'Risk flags (data leak, legal exposure, commitment mismatch)',
    ],
    implementation: 'packages/agents/src/workers/voice.agent.ts',
  },
  [AgentRole.WORKER_BROWSER]: {
    role: AgentRole.WORKER_BROWSER,
    displayName: 'Browser Automation',
    maturity: 'upgraded',
    strengths: [
      'Honeypot detection',
      'Domain allowlist with wildcard discipline',
      'Pre/post screenshots on every write',
      'Semantic selectors preferred over CSS classes',
    ],
    limitations: [
      'Browser automation against logged-in consumer sites (Twitter/Reddit) remains fragile by nature',
    ],
    implementation: 'packages/agents/src/workers/browser.agent.ts',
  },

  // ─── Strong (already reasonable, not bleeding edge) ────────────────────
  [AgentRole.WORKER_CODER]: {
    role: AgentRole.WORKER_CODER,
    displayName: 'Coder',
    maturity: 'world_class',
    strengths: ['Deep code-gen', 'Toolchain awareness', 'No-truncation invariant'],
    implementation: 'packages/agents/src/workers/coder.agent.ts',
  },
  [AgentRole.WORKER_DESIGNER]: {
    role: AgentRole.WORKER_DESIGNER,
    displayName: 'Designer (UI/UX)',
    maturity: 'strong',
    strengths: ['Design-system thinking', 'Accessibility awareness'],
    implementation: 'packages/agents/src/workers/designer.agent.ts',
  },
  [AgentRole.WORKER_KNOWLEDGE]: {
    role: AgentRole.WORKER_KNOWLEDGE,
    displayName: 'Knowledge',
    maturity: 'strong',
    strengths: ['RAG-first discipline', 'Source attribution', 'Calibrated confidence'],
    implementation: 'packages/agents/src/workers/knowledge.agent.ts',
  },
  [AgentRole.WORKER_SPREADSHEET]: {
    role: AgentRole.WORKER_SPREADSHEET,
    displayName: 'Spreadsheet / Data Analyst',
    maturity: 'upgraded',
    strengths: [
      'Forensic data profile (five-number summary + IQR outlier detection)',
      'Honest chart-type selection with explicit rules (never pie >6 categories, never 3D)',
      'Aggregation-matches-semantics discipline (never average IDs)',
      'Small-sample discipline: n<30 uses non-parametric summary',
      'Refuse-to-fabricate rule (no column inference from ambient knowledge)',
    ],
    implementation: 'packages/agents/src/workers/spreadsheet.agent.ts',
  },
  [AgentRole.WORKER_CONTENT]: {
    role: AgentRole.WORKER_CONTENT,
    displayName: 'Content',
    maturity: 'strong',
    strengths: ['Long-form generation', 'Format adaptation (blog / social / script)'],
    implementation: 'packages/agents/src/workers/content.agent.ts',
  },
  [AgentRole.WORKER_SEO]: {
    role: AgentRole.WORKER_SEO,
    displayName: 'SEO',
    maturity: 'strong',
    strengths: ['Technical SEO discipline', 'Structured data awareness'],
    implementation: 'packages/agents/src/workers/seo.agent.ts',
  },
  [AgentRole.WORKER_PR]: {
    role: AgentRole.WORKER_PR,
    displayName: 'PR / Comms',
    maturity: 'strong',
    strengths: ['AP Style', 'Crisis comms framework', 'Journalistic conventions'],
    implementation: 'packages/agents/src/workers/pr.agent.ts',
  },
  [AgentRole.WORKER_LEGAL]: {
    role: AgentRole.WORKER_LEGAL,
    displayName: 'Legal',
    maturity: 'strong',
    strengths: ['Contract law, privacy, IP, compliance scope'],
    implementation: 'packages/agents/src/workers/legal.agent.ts',
  },
  [AgentRole.WORKER_SUCCESS]: {
    role: AgentRole.WORKER_SUCCESS,
    displayName: 'Customer Success',
    maturity: 'world_class',
    strengths: ['VP CS persona', 'Health scoring', 'Renewal strategy'],
    implementation: 'packages/agents/src/workers/success.agent.ts',
  },
  [AgentRole.WORKER_ANALYTICS]: {
    role: AgentRole.WORKER_ANALYTICS,
    displayName: 'Analytics / BI',
    maturity: 'strong',
    strengths: ['Head of Data persona', 'Statistical rigor'],
    implementation: 'packages/agents/src/workers/analytics.agent.ts',
  },
  [AgentRole.WORKER_PRODUCT]: {
    role: AgentRole.WORKER_PRODUCT,
    displayName: 'Product (Senior PM)',
    maturity: 'world_class',
    strengths: [
      'RICE prioritization framework (Reach × Impact × Confidence / Effort)',
      'Jobs-to-be-done + INVEST user story criteria',
      '7-section PRD structure',
      'Problem-first, solution-second discipline',
    ],
    implementation: 'packages/agents/src/workers/product.agent.ts',
  },
  [AgentRole.WORKER_PROJECT]: {
    role: AgentRole.WORKER_PROJECT,
    displayName: 'Project Management',
    maturity: 'strong',
    strengths: ['Timeline / resource / milestone structure'],
    implementation: 'packages/agents/src/workers/project.agent.ts',
  },

  // ─── Vibe Coding (hero roles) ──────────────────────────────────────────
  [AgentRole.WORKER_APP_ARCHITECT]: {
    role: AgentRole.WORKER_APP_ARCHITECT,
    displayName: 'App Architect',
    maturity: 'world_class',
    strengths: ['File tree + data models + API contracts', 'Dependency resolution', 'No-truncation invariant'],
    implementation: 'packages/agents/src/workers/app-architect.agent.ts',
  },
  [AgentRole.WORKER_APP_GENERATOR]: {
    role: AgentRole.WORKER_APP_GENERATOR,
    displayName: 'App Generator',
    maturity: 'world_class',
    strengths: ['Complete-file generation (no stubs)', 'Framework-aware output'],
    implementation: 'packages/agents/src/workers/app-generator.agent.ts',
  },
  [AgentRole.WORKER_APP_DEBUGGER]: {
    role: AgentRole.WORKER_APP_DEBUGGER,
    displayName: 'App Debugger',
    maturity: 'world_class',
    strengths: ['≤3 retry tracking', 'Surgical fix discipline', 'Fingerprint loop detection'],
    implementation: 'packages/agents/src/workers/app-debugger.agent.ts',
  },
  [AgentRole.WORKER_APP_DEPLOYER]: {
    role: AgentRole.WORKER_APP_DEPLOYER,
    displayName: 'App Deployer',
    maturity: 'upgraded',
    strengths: [
      'Build-error classification (9 categories, retryable vs owner-action)',
      'Env-var preflight with consequence statements',
      'Domain / DNS / SSL state awareness',
      'Rollback recommendation on failure',
    ],
    implementation: 'packages/agents/src/workers/app-deployer.agent.ts',
  },
  [AgentRole.WORKER_SCREENSHOT_TO_CODE]: {
    role: AgentRole.WORKER_SCREENSHOT_TO_CODE,
    displayName: 'Screenshot to Code',
    maturity: 'strong',
    strengths: ['Image → design tokens', 'Typed output', 'Wired end-to-end via vibe-coding-execution service'],
    limitations: ['Quality scales with GPT-4o vision latency and input screenshot complexity'],
    implementation: 'packages/agents/src/workers/screenshot-to-code.agent.ts',
  },
};

/** Convenience accessor. */
export function getRoleManifestEntry(role: AgentRole): RoleManifestEntry {
  const entry = ROLE_MANIFEST[role];
  if (!entry) throw new Error(`Role not classified in manifest: ${role}`);
  return entry;
}

/** List every manifest entry — ordered by maturity (hero → experimental). */
export function listRoleManifest(): RoleManifestEntry[] {
  const order: Record<RoleMaturity, number> = {
    world_class: 0,
    upgraded: 1,
    strong: 2,
    moderate: 3,
    shallow: 4,
    experimental: 5,
  };
  return Object.values(ROLE_MANIFEST).sort(
    (a, b) =>
      order[a.maturity] - order[b.maturity] ||
      a.displayName.localeCompare(b.displayName),
  );
}

/** Aggregate counts — useful for truth-check and admin dashboards. */
export function getRoleManifestSummary() {
  const byMaturity: Record<RoleMaturity, number> = {
    world_class: 0,
    upgraded: 0,
    strong: 0,
    moderate: 0,
    shallow: 0,
    experimental: 0,
  };
  let total = 0;
  for (const entry of Object.values(ROLE_MANIFEST)) {
    byMaturity[entry.maturity] += 1;
    total += 1;
  }
  return { total, byMaturity };
}
