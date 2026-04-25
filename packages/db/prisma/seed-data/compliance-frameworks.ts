/**
 * SOC 2 Type 2 control catalog (real AICPA Trust Services Criteria, 2017
 * revised 2022). This is the source of truth used by `pnpm seed:compliance`.
 *
 * Source: AICPA Trust Services Criteria (TSP Section 100). 33 Common
 * Criteria (CC1.1 through CC9.2) covering the Security category, plus
 * 5 Confidentiality (C1.x), 4 Privacy (P1.x → P8.x) selected anchors,
 * 5 Availability (A1.x), 5 Processing Integrity (PI1.x).
 *
 * Each control is annotated with an `autoRuleKey` that resolves to an
 * auto-mapping rule in `packages/audit-compliance/src/auto-mapping-rules.ts`.
 * Controls without an `autoRuleKey` are human-mapped only — typically
 * organisational policies (CC1.1 "Demonstrates commitment to integrity")
 * that no audit-log row can satisfy.
 *
 * Adding a new framework: drop a new entry in `FRAMEWORKS` below, add
 * its controls, and re-run `pnpm seed:compliance`. The seed is
 * idempotent — re-runs upsert by (frameworkSlug, controlCode).
 */

export interface SeedControl {
  code: string;
  series: string;        // 'CC1', 'CC6', 'P1', etc.
  category: string;      // 'Common Criteria', 'Privacy', 'Availability', etc.
  title: string;
  description: string;
  autoRuleKey?: string;
  sortOrder: number;
}

export interface SeedFramework {
  slug: string;
  name: string;
  shortName: string;
  issuer: string;
  description: string;
  version: string;
  active: boolean;
  controls: SeedControl[];
}

const SOC2_TYPE2_CONTROLS: SeedControl[] = [
  // ─── CC1 — Control Environment ──────────────────────────────────────
  { code: 'CC1.1', series: 'CC1', category: 'Common Criteria', sortOrder: 101, title: 'Demonstrates commitment to integrity and ethical values', description: 'The entity demonstrates a commitment to integrity and ethical values.' },
  { code: 'CC1.2', series: 'CC1', category: 'Common Criteria', sortOrder: 102, title: 'Board exercises oversight responsibility', description: 'Management establishes oversight of the system of internal control.' },
  { code: 'CC1.3', series: 'CC1', category: 'Common Criteria', sortOrder: 103, title: 'Management establishes structures, reporting lines, and authorities', description: 'Management establishes, with board oversight, structures, reporting lines, and appropriate authorities and responsibilities.', autoRuleKey: 'tenant-rbac-changes' },
  { code: 'CC1.4', series: 'CC1', category: 'Common Criteria', sortOrder: 104, title: 'Demonstrates commitment to competence', description: 'The entity demonstrates a commitment to attract, develop, and retain competent individuals in alignment with objectives.', autoRuleKey: 'tenant-rbac-changes' },
  { code: 'CC1.5', series: 'CC1', category: 'Common Criteria', sortOrder: 105, title: 'Enforces accountability', description: 'The entity holds individuals accountable for their internal control responsibilities.', autoRuleKey: 'approval-decisions' },

  // ─── CC2 — Communication & Information ──────────────────────────────
  { code: 'CC2.1', series: 'CC2', category: 'Common Criteria', sortOrder: 201, title: 'Obtains or generates relevant information', description: 'The entity obtains or generates and uses relevant, quality information to support the functioning of internal control.', autoRuleKey: 'workflow-evidence-trail' },
  { code: 'CC2.2', series: 'CC2', category: 'Common Criteria', sortOrder: 202, title: 'Internally communicates information', description: 'The entity internally communicates information necessary to support the functioning of internal control.', autoRuleKey: 'workflow-evidence-trail' },
  { code: 'CC2.3', series: 'CC2', category: 'Common Criteria', sortOrder: 203, title: 'Communicates with external parties', description: 'The entity communicates with external parties regarding matters affecting the functioning of internal control.' },

  // ─── CC3 — Risk Assessment ──────────────────────────────────────────
  { code: 'CC3.1', series: 'CC3', category: 'Common Criteria', sortOrder: 301, title: 'Specifies suitable objectives', description: 'The entity specifies objectives with sufficient clarity to enable the identification and assessment of risks.' },
  { code: 'CC3.2', series: 'CC3', category: 'Common Criteria', sortOrder: 302, title: 'Identifies and analyses risk', description: 'The entity identifies risks to the achievement of its objectives and analyses risks as a basis for determining how the risks should be managed.', autoRuleKey: 'guardrail-and-injection-events' },
  { code: 'CC3.3', series: 'CC3', category: 'Common Criteria', sortOrder: 303, title: 'Considers fraud potential', description: 'The entity considers the potential for fraud in assessing risks to the achievement of objectives.', autoRuleKey: 'guardrail-and-injection-events' },
  { code: 'CC3.4', series: 'CC3', category: 'Common Criteria', sortOrder: 304, title: 'Identifies and assesses changes', description: 'The entity identifies and assesses changes that could significantly impact the system of internal control.', autoRuleKey: 'tenant-rbac-changes' },

  // ─── CC4 — Monitoring ───────────────────────────────────────────────
  { code: 'CC4.1', series: 'CC4', category: 'Common Criteria', sortOrder: 401, title: 'Selects, develops, and performs evaluations', description: 'The entity selects, develops, and performs ongoing and/or separate evaluations to ascertain whether the components of internal control are present and functioning.', autoRuleKey: 'workflow-failures' },
  { code: 'CC4.2', series: 'CC4', category: 'Common Criteria', sortOrder: 402, title: 'Evaluates and communicates deficiencies', description: 'The entity evaluates and communicates internal control deficiencies in a timely manner.', autoRuleKey: 'workflow-failures' },

  // ─── CC5 — Control Activities ───────────────────────────────────────
  { code: 'CC5.1', series: 'CC5', category: 'Common Criteria', sortOrder: 501, title: 'Selects and develops control activities', description: 'The entity selects and develops control activities that contribute to the mitigation of risks.', autoRuleKey: 'approval-decisions' },
  { code: 'CC5.2', series: 'CC5', category: 'Common Criteria', sortOrder: 502, title: 'Selects and develops technology controls', description: 'The entity selects and develops general control activities over technology to support the achievement of objectives.', autoRuleKey: 'tool-blocked-and-policy' },
  { code: 'CC5.3', series: 'CC5', category: 'Common Criteria', sortOrder: 503, title: 'Deploys policies and procedures', description: 'The entity deploys control activities through policies that establish what is expected and procedures that put policies into action.' },

  // ─── CC6 — Logical & Physical Access ────────────────────────────────
  { code: 'CC6.1', series: 'CC6', category: 'Common Criteria', sortOrder: 601, title: 'Implements logical access security', description: 'The entity implements logical access security software, infrastructure, and architectures over protected information assets.', autoRuleKey: 'tool-blocked-and-policy' },
  { code: 'CC6.2', series: 'CC6', category: 'Common Criteria', sortOrder: 602, title: 'Authorises and modifies access registrations', description: 'Prior to issuing system credentials, the entity registers and authorises new internal and external users.', autoRuleKey: 'tenant-rbac-changes' },
  { code: 'CC6.3', series: 'CC6', category: 'Common Criteria', sortOrder: 603, title: 'Authorises, modifies, removes access', description: 'The entity authorises, modifies, or removes access to data, software, functions based on roles and responsibilities.', autoRuleKey: 'approval-decisions' },
  { code: 'CC6.4', series: 'CC6', category: 'Common Criteria', sortOrder: 604, title: 'Restricts physical access', description: 'The entity restricts physical access to facilities and protected information assets.' },
  { code: 'CC6.5', series: 'CC6', category: 'Common Criteria', sortOrder: 605, title: 'Discontinues logical and physical protections', description: 'The entity discontinues logical and physical protections over physical assets only after the ability to read or recover data and software has been diminished and is no longer required.' },
  { code: 'CC6.6', series: 'CC6', category: 'Common Criteria', sortOrder: 606, title: 'Implements logical access security measures against external threats', description: 'The entity implements logical access security measures to protect against threats from sources outside its system boundaries.', autoRuleKey: 'guardrail-and-injection-events' },
  { code: 'CC6.7', series: 'CC6', category: 'Common Criteria', sortOrder: 607, title: 'Restricts and protects information transmission', description: 'The entity restricts the transmission, movement, and removal of information to authorised internal and external users and processes.', autoRuleKey: 'artifact-approval-gates' },
  { code: 'CC6.8', series: 'CC6', category: 'Common Criteria', sortOrder: 608, title: 'Implements controls to prevent or detect unauthorised software', description: 'The entity implements controls to prevent or detect and act upon the introduction of unauthorised or malicious software.', autoRuleKey: 'tool-blocked-and-policy' },

  // ─── CC7 — System Operations ────────────────────────────────────────
  { code: 'CC7.1', series: 'CC7', category: 'Common Criteria', sortOrder: 701, title: 'Detects and monitors changes to configurations', description: 'To meet its objectives, the entity uses detection and monitoring procedures to identify changes to configurations.', autoRuleKey: 'tenant-rbac-changes' },
  { code: 'CC7.2', series: 'CC7', category: 'Common Criteria', sortOrder: 702, title: 'Monitors system components for anomalies', description: 'The entity monitors system components and the operation of those components for anomalies that are indicative of malicious acts, natural disasters, and errors.', autoRuleKey: 'guardrail-and-injection-events' },
  { code: 'CC7.3', series: 'CC7', category: 'Common Criteria', sortOrder: 703, title: 'Evaluates security events', description: 'The entity evaluates security events to determine whether they could or have resulted in a failure of the entity to meet its objectives.', autoRuleKey: 'guardrail-and-injection-events' },
  { code: 'CC7.4', series: 'CC7', category: 'Common Criteria', sortOrder: 704, title: 'Responds to identified security incidents', description: 'The entity responds to identified security incidents by executing a defined incident response programme to understand, contain, remediate, and communicate.', autoRuleKey: 'workflow-failures' },
  { code: 'CC7.5', series: 'CC7', category: 'Common Criteria', sortOrder: 705, title: 'Identifies, develops, and implements activities to recover', description: 'The entity identifies, develops, and implements activities to recover from identified security incidents.', autoRuleKey: 'workflow-resumed-or-rolled-back' },

  // ─── CC8 — Change Management ────────────────────────────────────────
  { code: 'CC8.1', series: 'CC8', category: 'Common Criteria', sortOrder: 801, title: 'Authorises, designs, develops, configures, documents, tests, approves, and implements changes', description: 'The entity authorises, designs, develops, configures, documents, tests, approves, and implements changes to infrastructure, data, software, and procedures to meet its objectives.', autoRuleKey: 'artifact-approval-gates' },

  // ─── CC9 — Risk Mitigation ──────────────────────────────────────────
  { code: 'CC9.1', series: 'CC9', category: 'Common Criteria', sortOrder: 901, title: 'Identifies, selects, and develops risk mitigation activities', description: 'The entity identifies, selects, and develops risk mitigation activities for risks arising from potential business disruptions.' },
  { code: 'CC9.2', series: 'CC9', category: 'Common Criteria', sortOrder: 902, title: 'Assesses and manages risks associated with vendors', description: 'The entity assesses and manages risks associated with vendors and business partners.' },

  // ─── A — Availability (selected anchors) ────────────────────────────
  { code: 'A1.1', series: 'A1', category: 'Availability', sortOrder: 1101, title: 'Maintains, monitors, and evaluates current processing capacity', description: 'The entity maintains, monitors, and evaluates current processing capacity and use of system components to manage capacity demand.', autoRuleKey: 'workflow-evidence-trail' },
  { code: 'A1.2', series: 'A1', category: 'Availability', sortOrder: 1102, title: 'Authorises, designs, develops, implements, operates, approves, maintains, and monitors environmental protections', description: 'The entity authorises, designs, develops, implements, operates, approves, maintains, and monitors environmental protections, software, data backup processes, and recovery infrastructure.', autoRuleKey: 'workflow-resumed-or-rolled-back' },
  { code: 'A1.3', series: 'A1', category: 'Availability', sortOrder: 1103, title: 'Tests recovery plan procedures', description: 'The entity tests recovery plan procedures supporting system recovery to meet its objectives.' },

  // ─── PI — Processing Integrity (selected) ───────────────────────────
  { code: 'PI1.1', series: 'PI1', category: 'Processing Integrity', sortOrder: 1201, title: 'Obtains or generates, uses, and communicates relevant, quality information', description: 'The entity obtains or generates, uses, and communicates relevant, quality information to support the use of products and services.', autoRuleKey: 'workflow-evidence-trail' },
  { code: 'PI1.2', series: 'PI1', category: 'Processing Integrity', sortOrder: 1202, title: 'Implements policies and procedures over system inputs', description: 'The entity implements policies and procedures over system inputs to result in products and services that meet the entity\'s objectives.', autoRuleKey: 'tool-blocked-and-policy' },
  { code: 'PI1.3', series: 'PI1', category: 'Processing Integrity', sortOrder: 1203, title: 'Implements policies and procedures over system processing', description: 'The entity implements policies and procedures over system processing to result in products and services that meet the entity\'s objectives.', autoRuleKey: 'workflow-evidence-trail' },
  { code: 'PI1.4', series: 'PI1', category: 'Processing Integrity', sortOrder: 1204, title: 'Implements policies and procedures to make system outputs available to authorised parties', description: 'The entity implements policies and procedures to make system outputs available only to authorised parties.', autoRuleKey: 'artifact-approval-gates' },
  { code: 'PI1.5', series: 'PI1', category: 'Processing Integrity', sortOrder: 1205, title: 'Implements policies and procedures to store inputs, items in processing, and outputs', description: 'The entity implements policies and procedures to store inputs, items in processing, and outputs completely, accurately, and timely.', autoRuleKey: 'evidence-bundle-signed' },

  // ─── C — Confidentiality (selected) ─────────────────────────────────
  { code: 'C1.1', series: 'C1', category: 'Confidentiality', sortOrder: 1301, title: 'Identifies and maintains confidential information', description: 'The entity identifies and maintains confidential information to meet the entity\'s objectives related to confidentiality.', autoRuleKey: 'pii-detection' },
  { code: 'C1.2', series: 'C1', category: 'Confidentiality', sortOrder: 1302, title: 'Disposes of confidential information', description: 'The entity disposes of confidential information to meet the entity\'s objectives related to confidentiality.' },

  // ─── P — Privacy (selected anchors) ─────────────────────────────────
  { code: 'P1.1', series: 'P1', category: 'Privacy', sortOrder: 1401, title: 'Provides notice about its privacy practices', description: 'The entity provides notice to data subjects about its privacy practices to meet the entity\'s objectives related to privacy.', autoRuleKey: 'pii-detection' },
  { code: 'P3.1', series: 'P3', category: 'Privacy', sortOrder: 1402, title: 'Personal information is collected consistent with the entity\'s objectives', description: 'Personal information is collected consistent with the entity\'s objectives related to privacy.', autoRuleKey: 'pii-detection' },
  { code: 'P4.1', series: 'P4', category: 'Privacy', sortOrder: 1403, title: 'The entity limits the use of personal information', description: 'The entity limits the use of personal information to the purposes identified in the notice and consistent with consent received from the data subject.', autoRuleKey: 'pii-detection' },
  { code: 'P6.1', series: 'P6', category: 'Privacy', sortOrder: 1404, title: 'Disclosure to third parties', description: 'The entity discloses personal information to third parties only with consent of the data subject and only for the purposes identified in the notice.', autoRuleKey: 'artifact-approval-gates' },
  { code: 'P8.1', series: 'P8', category: 'Privacy', sortOrder: 1405, title: 'Implements a process for receiving, addressing, resolving, and communicating the resolution of inquiries', description: 'The entity implements a process for receiving, addressing, resolving, and communicating the resolution of inquiries, complaints, and disputes.', autoRuleKey: 'approval-decisions' },
];

export const FRAMEWORKS: SeedFramework[] = [
  {
    slug: 'soc2-type2',
    name: 'SOC 2 Type 2',
    shortName: 'SOC 2',
    issuer: 'AICPA',
    description: 'AICPA Trust Services Criteria covering Security (Common Criteria CC1–CC9), Availability, Processing Integrity, Confidentiality, and Privacy. Type 2 reports demonstrate that controls operated effectively over a defined period (typically 6–12 months).',
    version: '2017 TSC, revised 2022',
    active: true,
    controls: SOC2_TYPE2_CONTROLS,
  },
];
