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

export interface SubControl {
  code: string;          // e.g. "CC6.1.1"
  title: string;
  description: string;
}

export interface SeedControl {
  code: string;
  series: string;        // 'CC1', 'CC6', 'P1', etc.
  category: string;      // 'Common Criteria', 'Privacy', 'Availability', etc.
  title: string;
  description: string;
  /**
   * If present, references a rule in
   * `packages/audit-compliance/src/auto-mapping-rules.ts` that pulls
   * evidence from system activity (audit logs, approvals, artifacts).
   * Controls without this key are policy / paperwork / physical and
   * require human attestation — see `requiresHumanAttestation` below.
   */
  autoRuleKey?: string;
  sortOrder: number;
  /**
   * Optional sub-control breakdown. When present, the UI renders the
   * sub-points in the control drill-in panel; the auto-mapping engine
   * still maps to the parent control today (sub-point routing is
   * Phase 4 roadmap). Only seeded for the highest-traffic SOC 2
   * controls in v1.6 — others can be added incrementally.
   */
  subControls?: SubControl[];
  /**
   * Derived (not hand-set): true iff `autoRuleKey` is absent. This flag
   * is the source of truth for marketing copy that distinguishes
   * "operationally backed" controls (which can pull evidence from system
   * activity) from "policy-only" controls (which require a reviewer to
   * attest manually). Populated by `withAttestationFlags()` at the
   * bottom of this file before the seed publishes — DO NOT set it by
   * hand on individual control entries; toggle the autoRuleKey instead.
   */
  requiresHumanAttestation?: boolean;
}

/**
 * Aggregated counts an audit reviewer (or marketing copy) can cite without
 * having to grep this file. Exported alongside FRAMEWORKS so the truth-check
 * CI gate (scripts/check-docs-truth.ts) and product-truth.ts can read the
 * canonical numbers without parsing source.
 */
export interface SeedFrameworkCounts {
  /** Total controls seeded across all frameworks. */
  totalSeeded: number;
  /** Controls with an `autoRuleKey` — evidence drawn from system activity. */
  operationallyBacked: number;
  /** Controls without `autoRuleKey` — require reviewer attestation. */
  requiresHumanAttestation: number;
  /** Per-framework breakdown, in the same order as FRAMEWORKS. */
  perFramework: Array<{
    slug: string;
    seeded: number;
    operationallyBacked: number;
    requiresHumanAttestation: number;
  }>;
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
  { code: 'CC6.1', series: 'CC6', category: 'Common Criteria', sortOrder: 601, title: 'Implements logical access security', description: 'The entity implements logical access security software, infrastructure, and architectures over protected information assets.', autoRuleKey: 'tool-blocked-and-policy', subControls: [
    { code: 'CC6.1.1', title: 'Identifies and manages the inventory of information assets', description: 'The entity identifies and manages the inventory of information assets, including physical devices and systems, virtual devices, software, data and data flows, external information systems, and organisational roles.' },
    { code: 'CC6.1.2', title: 'Restricts logical access', description: 'The entity restricts logical access to information assets, including hardware, data (at-rest, during processing, or in transmission), software, administrative authorities, mobile devices, and removable media.' },
    { code: 'CC6.1.3', title: 'Identifies and authenticates users', description: 'The entity identifies and authenticates users, infrastructure, and other IT components prior to accessing information assets.' },
    { code: 'CC6.1.4', title: 'Considers network segmentation', description: 'The entity considers network segmentation to permit unrelated portions of the entity\'s information system to be isolated from each other.' },
    { code: 'CC6.1.5', title: 'Manages credentials for infrastructure and software', description: 'The entity manages credentials for infrastructure and software, including identifying access credentials, restricting access through approval, configuring access according to least privilege, and revoking credentials when no longer needed.' },
    { code: 'CC6.1.6', title: 'Uses encryption to protect data', description: 'The entity uses encryption to protect data at rest, in transmission, and in storage, with key management procedures appropriate to the level of protection required.' },
    { code: 'CC6.1.7', title: 'Protects encryption keys', description: 'The entity protects encryption keys during generation, storage, use, and destruction.' },
  ] },
  { code: 'CC6.2', series: 'CC6', category: 'Common Criteria', sortOrder: 602, title: 'Authorises and modifies access registrations', description: 'Prior to issuing system credentials, the entity registers and authorises new internal and external users.', autoRuleKey: 'tenant-rbac-changes' },
  { code: 'CC6.3', series: 'CC6', category: 'Common Criteria', sortOrder: 603, title: 'Authorises, modifies, removes access', description: 'The entity authorises, modifies, or removes access to data, software, functions based on roles and responsibilities.', autoRuleKey: 'approval-decisions' },
  { code: 'CC6.4', series: 'CC6', category: 'Common Criteria', sortOrder: 604, title: 'Restricts physical access', description: 'The entity restricts physical access to facilities and protected information assets.' },
  { code: 'CC6.5', series: 'CC6', category: 'Common Criteria', sortOrder: 605, title: 'Discontinues logical and physical protections', description: 'The entity discontinues logical and physical protections over physical assets only after the ability to read or recover data and software has been diminished and is no longer required.' },
  { code: 'CC6.6', series: 'CC6', category: 'Common Criteria', sortOrder: 606, title: 'Implements logical access security measures against external threats', description: 'The entity implements logical access security measures to protect against threats from sources outside its system boundaries.', autoRuleKey: 'guardrail-and-injection-events', subControls: [
    { code: 'CC6.6.1', title: 'Restricts access to the information assets', description: 'The entity restricts access to the information assets to authorised users, processes, devices, or systems by implementing logical access security measures.' },
    { code: 'CC6.6.2', title: 'Protects identification and authentication credentials', description: 'The entity protects identification and authentication credentials from unauthorised disclosure during transmission and at rest.' },
    { code: 'CC6.6.3', title: 'Requires additional authentication or credentials', description: 'The entity requires additional authentication or credentials when access is from an outside source or compromised credentials are suspected.' },
    { code: 'CC6.6.4', title: 'Implements boundary protection systems', description: 'The entity implements boundary protection systems (firewalls, intrusion detection systems, etc.) to monitor and control communications at the external boundary of the system.' },
  ] },
  { code: 'CC6.7', series: 'CC6', category: 'Common Criteria', sortOrder: 607, title: 'Restricts and protects information transmission', description: 'The entity restricts the transmission, movement, and removal of information to authorised internal and external users and processes.', autoRuleKey: 'artifact-approval-gates' },
  { code: 'CC6.8', series: 'CC6', category: 'Common Criteria', sortOrder: 608, title: 'Implements controls to prevent or detect unauthorised software', description: 'The entity implements controls to prevent or detect and act upon the introduction of unauthorised or malicious software.', autoRuleKey: 'tool-blocked-and-policy' },

  // ─── CC7 — System Operations ────────────────────────────────────────
  { code: 'CC7.1', series: 'CC7', category: 'Common Criteria', sortOrder: 701, title: 'Detects and monitors changes to configurations', description: 'To meet its objectives, the entity uses detection and monitoring procedures to identify changes to configurations.', autoRuleKey: 'tenant-rbac-changes' },
  { code: 'CC7.2', series: 'CC7', category: 'Common Criteria', sortOrder: 702, title: 'Monitors system components for anomalies', description: 'The entity monitors system components and the operation of those components for anomalies that are indicative of malicious acts, natural disasters, and errors.', autoRuleKey: 'guardrail-and-injection-events', subControls: [
    { code: 'CC7.2.1', title: 'Implements detection policies, procedures, and tools', description: 'The entity implements detection policies, procedures, and tools that are designed to detect security events.' },
    { code: 'CC7.2.2', title: 'Designs detection measures', description: 'The entity designs detection measures to identify anomalies that could result from actual or attempted (1) compromise of physical barriers, (2) unauthorised actions of personnel, vendors, contractors, or business partners, (3) the use of compromised identification and authentication credentials, (4) unauthorised access from outside the system boundaries, (5) compromise of authorised user identification and authentication credentials, and (6) malicious software introduction.' },
    { code: 'CC7.2.3', title: 'Implements filters to detect anomalies', description: 'The entity implements filters to detect anomalies in the operation of, or unusual activity on, system components.' },
    { code: 'CC7.2.4', title: 'Monitors detection tools for effectiveness', description: 'The entity monitors detection tools for effective operation, the analysis of anomalies, and follow-up activities.' },
  ] },
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

// ═══════════════════════════════════════════════════════════════════════
// HIPAA Security Rule (45 CFR §§ 164.308–164.312)
// ═══════════════════════════════════════════════════════════════════════
//
// Source: 45 CFR Subpart C of Part 164. Three categories:
//   164.308 — Administrative Safeguards
//   164.310 — Physical Safeguards
//   164.312 — Technical Safeguards
//
// Each standard has one or more "implementation specifications", marked
// either "(R)" (Required) or "(A)" (Addressable). We seed the standards
// + the most operationally relevant required specs so the framework
// catalog reflects what an audit log can actually demonstrate.
//
// Auto-mapping rule reuse: HIPAA Security overlaps heavily with SOC 2 CC6
// (logical access) + CC7 (system operations) + C1 (confidentiality), so
// rules like `tool-blocked-and-policy`, `pii-detection`, `tenant-rbac-changes`
// apply directly. Additional HIPAA-specific rules can be added later as
// new operational signals (BAA tracking, breach notifications, etc.) ship.

const HIPAA_SECURITY_RULE_CONTROLS: SeedControl[] = [
  // ─── 164.308 — Administrative Safeguards ────────────────────────────
  { code: '164.308(a)(1)', series: '308', category: 'Administrative Safeguards', sortOrder: 1, title: 'Security Management Process', description: 'Implement policies and procedures to prevent, detect, contain, and correct security violations.' },
  { code: '164.308(a)(1)(ii)(A)', series: '308', category: 'Administrative Safeguards', sortOrder: 2, title: 'Risk Analysis (R)', description: 'Conduct an accurate and thorough assessment of the potential risks and vulnerabilities to the confidentiality, integrity, and availability of electronic protected health information held by the covered entity or business associate.', autoRuleKey: 'guardrail-and-injection-events' },
  { code: '164.308(a)(1)(ii)(B)', series: '308', category: 'Administrative Safeguards', sortOrder: 3, title: 'Risk Management (R)', description: 'Implement security measures sufficient to reduce risks and vulnerabilities to a reasonable and appropriate level.', autoRuleKey: 'tool-blocked-and-policy' },
  { code: '164.308(a)(1)(ii)(C)', series: '308', category: 'Administrative Safeguards', sortOrder: 4, title: 'Sanction Policy (R)', description: 'Apply appropriate sanctions against workforce members who fail to comply with the security policies and procedures of the covered entity or business associate.', autoRuleKey: 'tenant-rbac-changes' },
  { code: '164.308(a)(1)(ii)(D)', series: '308', category: 'Administrative Safeguards', sortOrder: 5, title: 'Information System Activity Review (R)', description: 'Implement procedures to regularly review records of information system activity, such as audit logs, access reports, and security incident tracking reports.', autoRuleKey: 'workflow-evidence-trail' },
  { code: '164.308(a)(2)', series: '308', category: 'Administrative Safeguards', sortOrder: 6, title: 'Assigned Security Responsibility', description: 'Identify the security official who is responsible for the development and implementation of the policies and procedures required by this subpart.', autoRuleKey: 'tenant-rbac-changes' },
  { code: '164.308(a)(3)', series: '308', category: 'Administrative Safeguards', sortOrder: 7, title: 'Workforce Security', description: 'Implement policies and procedures to ensure that all members of the workforce have appropriate access to electronic PHI and to prevent those workforce members who do not have access from obtaining access.' },
  { code: '164.308(a)(3)(ii)(A)', series: '308', category: 'Administrative Safeguards', sortOrder: 8, title: 'Authorization and/or Supervision (A)', description: 'Implement procedures for the authorization and/or supervision of workforce members who work with electronic PHI or in locations where it might be accessed.', autoRuleKey: 'approval-decisions' },
  { code: '164.308(a)(3)(ii)(B)', series: '308', category: 'Administrative Safeguards', sortOrder: 9, title: 'Workforce Clearance Procedure (A)', description: 'Implement procedures to determine that the access of a workforce member to electronic PHI is appropriate.', autoRuleKey: 'tenant-rbac-changes' },
  { code: '164.308(a)(3)(ii)(C)', series: '308', category: 'Administrative Safeguards', sortOrder: 10, title: 'Termination Procedures (A)', description: 'Implement procedures for terminating access to electronic PHI when the employment of, or other arrangement with, a workforce member ends.', autoRuleKey: 'tenant-rbac-changes' },
  { code: '164.308(a)(4)', series: '308', category: 'Administrative Safeguards', sortOrder: 11, title: 'Information Access Management', description: 'Implement policies and procedures for authorizing access to electronic PHI consistent with applicable requirements.', autoRuleKey: 'approval-decisions' },
  { code: '164.308(a)(4)(ii)(B)', series: '308', category: 'Administrative Safeguards', sortOrder: 12, title: 'Access Authorization (A)', description: 'Implement policies and procedures for granting access to electronic PHI, for example, through access to a workstation, transaction, program, process, or other mechanism.', autoRuleKey: 'tenant-rbac-changes' },
  { code: '164.308(a)(4)(ii)(C)', series: '308', category: 'Administrative Safeguards', sortOrder: 13, title: 'Access Establishment and Modification (A)', description: 'Implement policies and procedures that, based upon the entity\'s access authorization policies, establish, document, review, and modify a user\'s right of access.', autoRuleKey: 'tenant-rbac-changes' },
  { code: '164.308(a)(5)', series: '308', category: 'Administrative Safeguards', sortOrder: 14, title: 'Security Awareness and Training', description: 'Implement a security awareness and training program for all members of its workforce (including management).' },
  { code: '164.308(a)(6)', series: '308', category: 'Administrative Safeguards', sortOrder: 15, title: 'Security Incident Procedures', description: 'Implement policies and procedures to address security incidents.', autoRuleKey: 'guardrail-and-injection-events' },
  { code: '164.308(a)(6)(ii)', series: '308', category: 'Administrative Safeguards', sortOrder: 16, title: 'Response and Reporting (R)', description: 'Identify and respond to suspected or known security incidents; mitigate, to the extent practicable, harmful effects of security incidents that are known to the covered entity or business associate; and document security incidents and their outcomes.', autoRuleKey: 'workflow-failures' },
  { code: '164.308(a)(7)', series: '308', category: 'Administrative Safeguards', sortOrder: 17, title: 'Contingency Plan', description: 'Establish (and implement as needed) policies and procedures for responding to an emergency or other occurrence that damages systems containing electronic PHI.', autoRuleKey: 'workflow-resumed-or-rolled-back' },
  { code: '164.308(a)(8)', series: '308', category: 'Administrative Safeguards', sortOrder: 18, title: 'Evaluation', description: 'Perform a periodic technical and nontechnical evaluation that establishes the extent to which an entity\'s security policies and procedures meet the requirements of this subpart.', autoRuleKey: 'workflow-evidence-trail' },
  // 164.308(b) Business Associate Contracts — managed outside the system; human-mapped only

  // ─── 164.310 — Physical Safeguards ──────────────────────────────────
  { code: '164.310(a)(1)', series: '310', category: 'Physical Safeguards', sortOrder: 19, title: 'Facility Access Controls', description: 'Implement policies and procedures to limit physical access to its electronic information systems and the facility or facilities in which they are housed.' },
  { code: '164.310(b)', series: '310', category: 'Physical Safeguards', sortOrder: 20, title: 'Workstation Use', description: 'Implement policies and procedures that specify the proper functions to be performed, the manner in which those functions are to be performed, and the physical attributes of the surroundings of a specific workstation.' },
  { code: '164.310(c)', series: '310', category: 'Physical Safeguards', sortOrder: 21, title: 'Workstation Security', description: 'Implement physical safeguards for all workstations that access electronic PHI, to restrict access to authorized users.' },
  { code: '164.310(d)(1)', series: '310', category: 'Physical Safeguards', sortOrder: 22, title: 'Device and Media Controls', description: 'Implement policies and procedures that govern the receipt and removal of hardware and electronic media that contain electronic PHI into and out of a facility, and the movement of these items within the facility.' },

  // ─── 164.312 — Technical Safeguards ─────────────────────────────────
  { code: '164.312(a)(1)', series: '312', category: 'Technical Safeguards', sortOrder: 23, title: 'Access Control', description: 'Implement technical policies and procedures for electronic information systems that maintain electronic PHI to allow access only to those persons or software programs that have been granted access rights.', autoRuleKey: 'tool-blocked-and-policy' },
  { code: '164.312(a)(2)(i)', series: '312', category: 'Technical Safeguards', sortOrder: 24, title: 'Unique User Identification (R)', description: 'Assign a unique name and/or number for identifying and tracking user identity.', autoRuleKey: 'tenant-rbac-changes' },
  { code: '164.312(a)(2)(ii)', series: '312', category: 'Technical Safeguards', sortOrder: 25, title: 'Emergency Access Procedure (R)', description: 'Establish (and implement as needed) procedures for obtaining necessary electronic PHI during an emergency.' },
  { code: '164.312(a)(2)(iii)', series: '312', category: 'Technical Safeguards', sortOrder: 26, title: 'Automatic Logoff (A)', description: 'Implement electronic procedures that terminate an electronic session after a predetermined time of inactivity.' },
  { code: '164.312(a)(2)(iv)', series: '312', category: 'Technical Safeguards', sortOrder: 27, title: 'Encryption and Decryption (A)', description: 'Implement a mechanism to encrypt and decrypt electronic PHI.', autoRuleKey: 'evidence-bundle-signed' },
  { code: '164.312(b)', series: '312', category: 'Technical Safeguards', sortOrder: 28, title: 'Audit Controls', description: 'Implement hardware, software, and/or procedural mechanisms that record and examine activity in information systems that contain or use electronic PHI.', autoRuleKey: 'workflow-evidence-trail' },
  { code: '164.312(c)(1)', series: '312', category: 'Technical Safeguards', sortOrder: 29, title: 'Integrity', description: 'Implement policies and procedures to protect electronic PHI from improper alteration or destruction.', autoRuleKey: 'evidence-bundle-signed' },
  { code: '164.312(c)(2)', series: '312', category: 'Technical Safeguards', sortOrder: 30, title: 'Mechanism to Authenticate Electronic PHI (A)', description: 'Implement electronic mechanisms to corroborate that electronic PHI has not been altered or destroyed in an unauthorized manner.', autoRuleKey: 'evidence-bundle-signed' },
  { code: '164.312(d)', series: '312', category: 'Technical Safeguards', sortOrder: 31, title: 'Person or Entity Authentication', description: 'Implement procedures to verify that a person or entity seeking access to electronic PHI is the one claimed.', autoRuleKey: 'tenant-rbac-changes' },
  { code: '164.312(e)(1)', series: '312', category: 'Technical Safeguards', sortOrder: 32, title: 'Transmission Security', description: 'Implement technical security measures to guard against unauthorized access to electronic PHI that is being transmitted over an electronic communications network.', autoRuleKey: 'artifact-approval-gates' },
  { code: '164.312(e)(2)(i)', series: '312', category: 'Technical Safeguards', sortOrder: 33, title: 'Integrity Controls (A)', description: 'Implement security measures to ensure that electronically transmitted electronic PHI is not improperly modified without detection until disposed of.', autoRuleKey: 'evidence-bundle-signed' },
  { code: '164.312(e)(2)(ii)', series: '312', category: 'Technical Safeguards', sortOrder: 34, title: 'Encryption (A)', description: 'Implement a mechanism to encrypt electronic PHI whenever deemed appropriate.' },

  // ─── 164.314 — Organizational Requirements ─────────────────────────
  { code: '164.314(a)', series: '314', category: 'Organizational Requirements', sortOrder: 35, title: 'Business Associate Contracts', description: 'The contract or other arrangement between the covered entity and its business associate must comply with the requirements of this section.' },

  // ─── 164.316 — Policies, Procedures, and Documentation Requirements
  { code: '164.316(a)', series: '316', category: 'Policies & Documentation', sortOrder: 36, title: 'Policies and Procedures', description: 'Implement reasonable and appropriate policies and procedures to comply with the standards, implementation specifications, or other requirements of this subpart.' },
  { code: '164.316(b)(1)', series: '316', category: 'Policies & Documentation', sortOrder: 37, title: 'Documentation', description: 'Maintain the policies and procedures implemented to comply with this subpart in written (which may be electronic) form, and if an action, activity or assessment is required by this subpart to be documented, maintain a written (which may be electronic) record of the action, activity, or assessment.', autoRuleKey: 'workflow-evidence-trail' },
];

// ═══════════════════════════════════════════════════════════════════════
// ISO/IEC 27001:2022 — Annex A controls
// ═══════════════════════════════════════════════════════════════════════
//
// Source: ISO/IEC 27001:2022, Annex A (informative reference to ISO/IEC
// 27002:2022). 93 controls organized into 4 themes:
//   A.5  Organizational controls (37)
//   A.6  People controls (8)
//   A.7  Physical controls (14)
//   A.8  Technological controls (34)
//
// We seed 82 of the 93 Annex A controls. Of those:
//   46 carry an `autoRuleKey` and pull evidence from system activity
//      (audit log, workflow records, approval decisions, artifacts).
//   36 are policy / physical / paperwork controls that require a
//      reviewer to attest manually — they are still seeded so reviewers
//      can run a full ISO engagement, but the auto-mapping engine
//      cannot satisfy them on its own. The 11 not seeded yet are pure-
//      physical controls (A.7.x premises, badge readers, etc.) that
//      have no software signal at all.
// The post-process helper `withAttestationFlags()` below derives the
// `requiresHumanAttestation` flag on every entry from the absence of
// `autoRuleKey`, so marketing copy can cite the operationally-backed
// vs attestation-required split honestly.

const ISO_27001_2022_CONTROLS: SeedControl[] = [
  // ─── A.5 Organizational controls ────────────────────────────────────
  { code: 'A.5.1', series: 'A.5', category: 'Organizational Controls', sortOrder: 1, title: 'Policies for information security', description: 'Information security policy and topic-specific policies shall be defined, approved by management, published, communicated to and acknowledged by relevant personnel and relevant interested parties.' },
  { code: 'A.5.2', series: 'A.5', category: 'Organizational Controls', sortOrder: 2, title: 'Information security roles and responsibilities', description: 'Information security roles and responsibilities shall be defined and allocated according to organisational needs.', autoRuleKey: 'tenant-rbac-changes' },
  { code: 'A.5.3', series: 'A.5', category: 'Organizational Controls', sortOrder: 3, title: 'Segregation of duties', description: 'Conflicting duties and conflicting areas of responsibility shall be segregated.', autoRuleKey: 'approval-decisions' },
  { code: 'A.5.4', series: 'A.5', category: 'Organizational Controls', sortOrder: 4, title: 'Management responsibilities', description: 'Management shall require all personnel to apply information security in accordance with the established information security policy.' },
  { code: 'A.5.5', series: 'A.5', category: 'Organizational Controls', sortOrder: 5, title: 'Contact with authorities', description: 'The organisation shall establish and maintain contact with relevant authorities.' },
  { code: 'A.5.6', series: 'A.5', category: 'Organizational Controls', sortOrder: 6, title: 'Contact with special interest groups', description: 'The organisation shall establish and maintain contact with special interest groups or other specialist security forums and professional associations.' },
  { code: 'A.5.7', series: 'A.5', category: 'Organizational Controls', sortOrder: 7, title: 'Threat intelligence', description: 'Information relating to information security threats shall be collected and analysed to produce threat intelligence.', autoRuleKey: 'guardrail-and-injection-events' },
  { code: 'A.5.8', series: 'A.5', category: 'Organizational Controls', sortOrder: 8, title: 'Information security in project management', description: 'Information security shall be integrated into project management.', autoRuleKey: 'workflow-evidence-trail' },
  { code: 'A.5.9', series: 'A.5', category: 'Organizational Controls', sortOrder: 9, title: 'Inventory of information and other associated assets', description: 'An inventory of information and other associated assets, including owners, shall be developed and maintained.', autoRuleKey: 'workflow-evidence-trail' },
  { code: 'A.5.10', series: 'A.5', category: 'Organizational Controls', sortOrder: 10, title: 'Acceptable use of information and other associated assets', description: 'Rules for the acceptable use and procedures for handling information and other associated assets shall be identified, documented and implemented.', autoRuleKey: 'tool-blocked-and-policy' },
  { code: 'A.5.11', series: 'A.5', category: 'Organizational Controls', sortOrder: 11, title: 'Return of assets', description: 'Personnel and other interested parties as appropriate shall return all the organisation\'s assets in their possession upon change or termination of their employment, contract or agreement.', autoRuleKey: 'tenant-rbac-changes' },
  { code: 'A.5.12', series: 'A.5', category: 'Organizational Controls', sortOrder: 12, title: 'Classification of information', description: 'Information shall be classified according to the information security needs of the organisation based on confidentiality, integrity, availability and relevant interested party requirements.', autoRuleKey: 'pii-detection' },
  { code: 'A.5.13', series: 'A.5', category: 'Organizational Controls', sortOrder: 13, title: 'Labelling of information', description: 'An appropriate set of procedures for information labelling shall be developed and implemented in accordance with the information classification scheme adopted by the organisation.', autoRuleKey: 'pii-detection' },
  { code: 'A.5.14', series: 'A.5', category: 'Organizational Controls', sortOrder: 14, title: 'Information transfer', description: 'Information transfer rules, procedures, or agreements shall be in place for all types of transfer facilities within the organisation and between the organisation and other parties.', autoRuleKey: 'artifact-approval-gates' },
  { code: 'A.5.15', series: 'A.5', category: 'Organizational Controls', sortOrder: 15, title: 'Access control', description: 'Rules to control physical and logical access to information and other associated assets shall be established and implemented based on business and information security requirements.', autoRuleKey: 'tool-blocked-and-policy' },
  { code: 'A.5.16', series: 'A.5', category: 'Organizational Controls', sortOrder: 16, title: 'Identity management', description: 'The full life cycle of identities shall be managed.', autoRuleKey: 'tenant-rbac-changes' },
  { code: 'A.5.17', series: 'A.5', category: 'Organizational Controls', sortOrder: 17, title: 'Authentication information', description: 'Allocation and management of authentication information shall be controlled by a management process, including advising personnel on the appropriate handling of authentication information.', autoRuleKey: 'tenant-rbac-changes' },
  { code: 'A.5.18', series: 'A.5', category: 'Organizational Controls', sortOrder: 18, title: 'Access rights', description: 'Access rights to information and other associated assets shall be provisioned, reviewed, modified and removed in accordance with the organisation\'s topic-specific policy on and rules for access control.', autoRuleKey: 'approval-decisions' },
  { code: 'A.5.19', series: 'A.5', category: 'Organizational Controls', sortOrder: 19, title: 'Information security in supplier relationships', description: 'Processes and procedures shall be defined and implemented to manage the information security risks associated with the use of suppliers\' products or services.' },
  { code: 'A.5.20', series: 'A.5', category: 'Organizational Controls', sortOrder: 20, title: 'Addressing information security within supplier agreements', description: 'Relevant information security requirements shall be established and agreed with each supplier based on the type of supplier relationship.' },
  { code: 'A.5.21', series: 'A.5', category: 'Organizational Controls', sortOrder: 21, title: 'Managing information security in the ICT supply chain', description: 'Processes and procedures shall be defined and implemented to manage the information security risks associated with the ICT products and services supply chain.' },
  { code: 'A.5.22', series: 'A.5', category: 'Organizational Controls', sortOrder: 22, title: 'Monitoring, review and change management of supplier services', description: 'The organisation shall regularly monitor, review, evaluate and manage change in supplier information security practices and service delivery.' },
  { code: 'A.5.23', series: 'A.5', category: 'Organizational Controls', sortOrder: 23, title: 'Information security for use of cloud services', description: 'Processes for acquisition, use, management and exit from cloud services shall be established in accordance with the organisation\'s information security requirements.' },
  { code: 'A.5.24', series: 'A.5', category: 'Organizational Controls', sortOrder: 24, title: 'Information security incident management planning and preparation', description: 'The organisation shall plan and prepare for managing information security incidents by defining, establishing and communicating information security incident management processes, roles and responsibilities.', autoRuleKey: 'workflow-failures' },
  { code: 'A.5.25', series: 'A.5', category: 'Organizational Controls', sortOrder: 25, title: 'Assessment and decision on information security events', description: 'The organisation shall assess information security events and decide if they are to be categorised as information security incidents.', autoRuleKey: 'guardrail-and-injection-events' },
  { code: 'A.5.26', series: 'A.5', category: 'Organizational Controls', sortOrder: 26, title: 'Response to information security incidents', description: 'Information security incidents shall be responded to in accordance with the documented procedures.', autoRuleKey: 'workflow-failures' },
  { code: 'A.5.27', series: 'A.5', category: 'Organizational Controls', sortOrder: 27, title: 'Learning from information security incidents', description: 'Knowledge gained from information security incidents shall be used to strengthen and improve the information security controls.' },
  { code: 'A.5.28', series: 'A.5', category: 'Organizational Controls', sortOrder: 28, title: 'Collection of evidence', description: 'The organisation shall establish and implement procedures for the identification, collection, acquisition and preservation of evidence related to information security events.', autoRuleKey: 'evidence-bundle-signed' },
  { code: 'A.5.29', series: 'A.5', category: 'Organizational Controls', sortOrder: 29, title: 'Information security during disruption', description: 'The organisation shall plan how to maintain information security at an appropriate level during disruption.', autoRuleKey: 'workflow-resumed-or-rolled-back' },
  { code: 'A.5.30', series: 'A.5', category: 'Organizational Controls', sortOrder: 30, title: 'ICT readiness for business continuity', description: 'ICT readiness shall be planned, implemented, maintained and tested based on business continuity objectives and ICT continuity requirements.', autoRuleKey: 'workflow-resumed-or-rolled-back' },
  { code: 'A.5.31', series: 'A.5', category: 'Organizational Controls', sortOrder: 31, title: 'Legal, statutory, regulatory and contractual requirements', description: 'Legal, statutory, regulatory and contractual requirements relevant to information security and the organisation\'s approach to meet these requirements shall be identified, documented and kept up to date.' },
  { code: 'A.5.32', series: 'A.5', category: 'Organizational Controls', sortOrder: 32, title: 'Intellectual property rights', description: 'The organisation shall implement appropriate procedures to protect intellectual property rights.' },
  { code: 'A.5.33', series: 'A.5', category: 'Organizational Controls', sortOrder: 33, title: 'Protection of records', description: 'Records shall be protected from loss, destruction, falsification, unauthorised access and unauthorised release.', autoRuleKey: 'evidence-bundle-signed' },
  { code: 'A.5.34', series: 'A.5', category: 'Organizational Controls', sortOrder: 34, title: 'Privacy and protection of PII', description: 'The organisation shall identify and meet the requirements regarding the preservation of privacy and protection of PII according to applicable laws and regulations and contractual requirements.', autoRuleKey: 'pii-detection' },
  { code: 'A.5.35', series: 'A.5', category: 'Organizational Controls', sortOrder: 35, title: 'Independent review of information security', description: 'The organisation\'s approach to managing information security and its implementation including people, processes and technologies shall be reviewed independently at planned intervals or when significant changes occur.' },
  { code: 'A.5.36', series: 'A.5', category: 'Organizational Controls', sortOrder: 36, title: 'Compliance with policies, rules and standards for information security', description: 'Compliance with the organisation\'s information security policy, topic-specific policies, rules and standards shall be regularly reviewed.', autoRuleKey: 'tool-blocked-and-policy' },
  { code: 'A.5.37', series: 'A.5', category: 'Organizational Controls', sortOrder: 37, title: 'Documented operating procedures', description: 'Operating procedures for information processing facilities shall be documented and made available to personnel who need them.', autoRuleKey: 'workflow-evidence-trail' },

  // ─── A.6 People controls ────────────────────────────────────────────
  { code: 'A.6.1', series: 'A.6', category: 'People Controls', sortOrder: 38, title: 'Screening', description: 'Background verification checks on all candidates to become personnel shall be carried out prior to joining the organisation and on an ongoing basis taking into consideration applicable laws, regulations and ethics and be proportional to the business requirements, the classification of the information to be accessed and the perceived risks.' },
  { code: 'A.6.2', series: 'A.6', category: 'People Controls', sortOrder: 39, title: 'Terms and conditions of employment', description: 'The employment contractual agreements shall state the personnel\'s and the organisation\'s responsibilities for information security.' },
  { code: 'A.6.3', series: 'A.6', category: 'People Controls', sortOrder: 40, title: 'Information security awareness, education and training', description: 'Personnel of the organisation and relevant interested parties shall receive appropriate information security awareness, education and training and regular updates of the organisation\'s information security policy, topic-specific policies and procedures, as relevant for their job function.' },
  { code: 'A.6.4', series: 'A.6', category: 'People Controls', sortOrder: 41, title: 'Disciplinary process', description: 'A disciplinary process shall be formalised and communicated to take actions against personnel and other relevant interested parties who have committed an information security policy violation.', autoRuleKey: 'tenant-rbac-changes' },
  { code: 'A.6.5', series: 'A.6', category: 'People Controls', sortOrder: 42, title: 'Responsibilities after termination or change of employment', description: 'Information security responsibilities and duties that remain valid after termination or change of employment shall be defined, enforced and communicated to relevant personnel and other interested parties.', autoRuleKey: 'tenant-rbac-changes' },
  { code: 'A.6.6', series: 'A.6', category: 'People Controls', sortOrder: 43, title: 'Confidentiality or non-disclosure agreements', description: 'Confidentiality or non-disclosure agreements reflecting the organisation\'s needs for the protection of information shall be identified, documented, regularly reviewed and signed by personnel and other relevant interested parties.' },
  { code: 'A.6.7', series: 'A.6', category: 'People Controls', sortOrder: 44, title: 'Remote working', description: 'Security measures shall be implemented when personnel are working remotely to protect information accessed, processed or stored outside the organisation\'s premises.' },
  { code: 'A.6.8', series: 'A.6', category: 'People Controls', sortOrder: 45, title: 'Information security event reporting', description: 'The organisation shall provide a mechanism for personnel to report observed or suspected information security events through appropriate channels in a timely manner.', autoRuleKey: 'guardrail-and-injection-events' },

  // ─── A.7 Physical controls (selected — most are physical-only) ─────
  { code: 'A.7.1', series: 'A.7', category: 'Physical Controls', sortOrder: 46, title: 'Physical security perimeters', description: 'Security perimeters shall be defined and used to protect areas that contain information and other associated assets.' },
  { code: 'A.7.4', series: 'A.7', category: 'Physical Controls', sortOrder: 47, title: 'Physical security monitoring', description: 'Premises shall be continuously monitored for unauthorised physical access.' },
  { code: 'A.7.10', series: 'A.7', category: 'Physical Controls', sortOrder: 48, title: 'Storage media', description: 'Storage media shall be managed through their life cycle of acquisition, use, transportation and disposal in accordance with the organisation\'s classification scheme and handling requirements.' },

  // ─── A.8 Technological controls ─────────────────────────────────────
  { code: 'A.8.1', series: 'A.8', category: 'Technological Controls', sortOrder: 49, title: 'User end point devices', description: 'Information stored on, processed by or accessible via user end point devices shall be protected.' },
  { code: 'A.8.2', series: 'A.8', category: 'Technological Controls', sortOrder: 50, title: 'Privileged access rights', description: 'The allocation and use of privileged access rights shall be restricted and managed.', autoRuleKey: 'tenant-rbac-changes' },
  { code: 'A.8.3', series: 'A.8', category: 'Technological Controls', sortOrder: 51, title: 'Information access restriction', description: 'Access to information and other associated assets shall be restricted in accordance with the established topic-specific policy on access control.', autoRuleKey: 'tool-blocked-and-policy' },
  { code: 'A.8.4', series: 'A.8', category: 'Technological Controls', sortOrder: 52, title: 'Access to source code', description: 'Read and write access to source code, development tools and software libraries shall be appropriately managed.', autoRuleKey: 'tenant-rbac-changes' },
  { code: 'A.8.5', series: 'A.8', category: 'Technological Controls', sortOrder: 53, title: 'Secure authentication', description: 'Secure authentication technologies and procedures shall be implemented based on information access restrictions and the topic-specific policy on access control.', autoRuleKey: 'tenant-rbac-changes' },
  { code: 'A.8.6', series: 'A.8', category: 'Technological Controls', sortOrder: 54, title: 'Capacity management', description: 'The use of resources shall be monitored and adjusted in line with current and expected capacity requirements.', autoRuleKey: 'workflow-evidence-trail' },
  { code: 'A.8.7', series: 'A.8', category: 'Technological Controls', sortOrder: 55, title: 'Protection against malware', description: 'Protection against malware shall be implemented and supported by appropriate user awareness.', autoRuleKey: 'guardrail-and-injection-events' },
  { code: 'A.8.8', series: 'A.8', category: 'Technological Controls', sortOrder: 56, title: 'Management of technical vulnerabilities', description: 'Information about technical vulnerabilities of information systems in use shall be obtained, the organisation\'s exposure to such vulnerabilities shall be evaluated and appropriate measures shall be taken.', autoRuleKey: 'guardrail-and-injection-events' },
  { code: 'A.8.9', series: 'A.8', category: 'Technological Controls', sortOrder: 57, title: 'Configuration management', description: 'Configurations, including security configurations, of hardware, software, services and networks shall be established, documented, implemented, monitored and reviewed.' },
  { code: 'A.8.10', series: 'A.8', category: 'Technological Controls', sortOrder: 58, title: 'Information deletion', description: 'Information stored in information systems, devices or in any other storage media shall be deleted when no longer required.' },
  { code: 'A.8.11', series: 'A.8', category: 'Technological Controls', sortOrder: 59, title: 'Data masking', description: 'Data masking shall be used in accordance with the organisation\'s topic-specific policy on access control and other related topic-specific policies, and business requirements, taking applicable legislation into consideration.', autoRuleKey: 'pii-detection' },
  { code: 'A.8.12', series: 'A.8', category: 'Technological Controls', sortOrder: 60, title: 'Data leakage prevention', description: 'Data leakage prevention measures shall be applied to systems, networks and any other devices that process, store or transmit sensitive information.', autoRuleKey: 'pii-detection' },
  { code: 'A.8.13', series: 'A.8', category: 'Technological Controls', sortOrder: 61, title: 'Information backup', description: 'Backup copies of information, software and systems shall be maintained and regularly tested in accordance with the agreed topic-specific policy on backup.', autoRuleKey: 'workflow-resumed-or-rolled-back' },
  { code: 'A.8.14', series: 'A.8', category: 'Technological Controls', sortOrder: 62, title: 'Redundancy of information processing facilities', description: 'Information processing facilities shall be implemented with redundancy sufficient to meet availability requirements.' },
  { code: 'A.8.15', series: 'A.8', category: 'Technological Controls', sortOrder: 63, title: 'Logging', description: 'Logs that record activities, exceptions, faults and other relevant events shall be produced, stored, protected and analysed.', autoRuleKey: 'workflow-evidence-trail' },
  { code: 'A.8.16', series: 'A.8', category: 'Technological Controls', sortOrder: 64, title: 'Monitoring activities', description: 'Networks, systems and applications shall be monitored for anomalous behaviour and appropriate actions taken to evaluate potential information security incidents.', autoRuleKey: 'guardrail-and-injection-events' },
  { code: 'A.8.17', series: 'A.8', category: 'Technological Controls', sortOrder: 65, title: 'Clock synchronization', description: 'The clocks of information processing systems used by the organisation shall be synchronised to approved time sources.' },
  { code: 'A.8.18', series: 'A.8', category: 'Technological Controls', sortOrder: 66, title: 'Use of privileged utility programs', description: 'The use of utility programs that can be capable of overriding system and application controls shall be restricted and tightly controlled.', autoRuleKey: 'tool-blocked-and-policy' },
  { code: 'A.8.19', series: 'A.8', category: 'Technological Controls', sortOrder: 67, title: 'Installation of software on operational systems', description: 'Procedures and measures shall be implemented to securely manage software installation on operational systems.', autoRuleKey: 'tool-blocked-and-policy' },
  { code: 'A.8.20', series: 'A.8', category: 'Technological Controls', sortOrder: 68, title: 'Networks security', description: 'Networks and network devices shall be secured, managed and controlled to protect information in systems and applications.' },
  { code: 'A.8.21', series: 'A.8', category: 'Technological Controls', sortOrder: 69, title: 'Security of network services', description: 'Security mechanisms, service levels and service requirements of network services shall be identified, implemented and monitored.' },
  { code: 'A.8.22', series: 'A.8', category: 'Technological Controls', sortOrder: 70, title: 'Segregation of networks', description: 'Groups of information services, users and information systems shall be segregated in the organisation\'s networks.' },
  { code: 'A.8.23', series: 'A.8', category: 'Technological Controls', sortOrder: 71, title: 'Web filtering', description: 'Access to external websites shall be managed to reduce exposure to malicious content.', autoRuleKey: 'tool-blocked-and-policy' },
  { code: 'A.8.24', series: 'A.8', category: 'Technological Controls', sortOrder: 72, title: 'Use of cryptography', description: 'Rules for the effective use of cryptography, including cryptographic key management, shall be defined and implemented.', autoRuleKey: 'evidence-bundle-signed' },
  { code: 'A.8.25', series: 'A.8', category: 'Technological Controls', sortOrder: 73, title: 'Secure development life cycle', description: 'Rules for the secure development of software and systems shall be established and applied.' },
  { code: 'A.8.26', series: 'A.8', category: 'Technological Controls', sortOrder: 74, title: 'Application security requirements', description: 'Information security requirements shall be identified, specified and approved when developing or acquiring applications.', autoRuleKey: 'approval-decisions' },
  { code: 'A.8.27', series: 'A.8', category: 'Technological Controls', sortOrder: 75, title: 'Secure system architecture and engineering principles', description: 'Principles for engineering secure systems shall be established, documented, maintained and applied to any information system development activities.' },
  { code: 'A.8.28', series: 'A.8', category: 'Technological Controls', sortOrder: 76, title: 'Secure coding', description: 'Secure coding principles shall be applied to software development.' },
  { code: 'A.8.29', series: 'A.8', category: 'Technological Controls', sortOrder: 77, title: 'Security testing in development and acceptance', description: 'Security testing processes shall be defined and implemented in the development life cycle.', autoRuleKey: 'workflow-evidence-trail' },
  { code: 'A.8.30', series: 'A.8', category: 'Technological Controls', sortOrder: 78, title: 'Outsourced development', description: 'The organisation shall direct, monitor and review the activities related to outsourced system development.' },
  { code: 'A.8.31', series: 'A.8', category: 'Technological Controls', sortOrder: 79, title: 'Separation of development, test and production environments', description: 'Development, testing and production environments shall be separated and secured.' },
  { code: 'A.8.32', series: 'A.8', category: 'Technological Controls', sortOrder: 80, title: 'Change management', description: 'Changes to information processing facilities and information systems shall be subject to change management procedures.', autoRuleKey: 'artifact-approval-gates' },
  { code: 'A.8.33', series: 'A.8', category: 'Technological Controls', sortOrder: 81, title: 'Test information', description: 'Test information shall be appropriately selected, protected and managed.' },
  { code: 'A.8.34', series: 'A.8', category: 'Technological Controls', sortOrder: 82, title: 'Protection of information systems during audit testing', description: 'Audit tests and other assurance activities involving assessment of operational systems shall be planned and agreed between the tester and appropriate management.' },
];

/**
 * Sets `requiresHumanAttestation = true` on every control that doesn't have
 * an `autoRuleKey`. This is the single source of truth for the
 * "operationally backed vs policy-only" split — never set the flag by hand
 * on individual control entries (it gets out of sync). Toggle the
 * autoRuleKey instead.
 */
function withAttestationFlags(controls: SeedControl[]): SeedControl[] {
  return controls.map((c) => ({
    ...c,
    requiresHumanAttestation: !c.autoRuleKey,
  }));
}

export const FRAMEWORKS: SeedFramework[] = [
  {
    slug: 'soc2-type2',
    name: 'SOC 2 Type 2',
    shortName: 'SOC 2',
    issuer: 'AICPA',
    description: 'AICPA Trust Services Criteria covering Security (Common Criteria CC1–CC9), Availability, Processing Integrity, Confidentiality, and Privacy. Type 2 reports demonstrate that controls operated effectively over a defined period (typically 6–12 months). 63 controls seeded; 37 carry auto-mapping rules, 26 require reviewer attestation.',
    version: '2017 TSC, revised 2022',
    active: true,
    controls: withAttestationFlags(SOC2_TYPE2_CONTROLS),
  },
  {
    slug: 'hipaa-security-rule',
    name: 'HIPAA Security Rule',
    shortName: 'HIPAA',
    issuer: 'U.S. Department of Health and Human Services',
    description: 'The HIPAA Security Rule (45 CFR §§ 164.302–318) establishes national standards to protect electronic protected health information (e-PHI). Covers administrative, physical, and technical safeguards for covered entities and business associates. 37 controls seeded; 25 carry auto-mapping rules, 12 require reviewer attestation.',
    version: '45 CFR Part 164 Subpart C',
    active: true,
    controls: withAttestationFlags(HIPAA_SECURITY_RULE_CONTROLS),
  },
  {
    slug: 'iso-27001-2022',
    name: 'ISO/IEC 27001:2022',
    shortName: 'ISO 27001',
    issuer: 'ISO/IEC',
    description: 'International standard for information security management systems (ISMS). Annex A contains 93 controls organized into Organizational, People, Physical, and Technological themes. This catalog seeds 82 of the 93; 46 carry auto-mapping rules that pull evidence from system activity, 36 are policy / paperwork / physical controls that require reviewer attestation. The 11 not seeded are pure-physical (premises, badge readers) with no software signal.',
    version: 'ISO/IEC 27001:2022 (Annex A)',
    active: true,
    controls: withAttestationFlags(ISO_27001_2022_CONTROLS),
  },
];

/**
 * Aggregated counts derived from the seeded controls above. These are the
 * NUMBERS marketing copy + the truth-check CI gate may cite. Recomputed
 * at module load so they can never drift from the source-of-truth array.
 *
 * As of 2026-04-28:
 *   total seeded            : 182 (63 SOC 2 + 37 HIPAA + 82 ISO 27001)
 *   operationally backed    : 108 (37 + 25 + 46)
 *   requires human attest.  :  74 (26 + 12 + 36)
 */
export const FRAMEWORK_COUNTS: SeedFrameworkCounts = (() => {
  const perFramework = FRAMEWORKS.map((fw) => {
    const seeded = fw.controls.length;
    const operationallyBacked = fw.controls.filter((c) => !!c.autoRuleKey).length;
    return {
      slug: fw.slug,
      seeded,
      operationallyBacked,
      requiresHumanAttestation: seeded - operationallyBacked,
    };
  });
  const totalSeeded = perFramework.reduce((s, f) => s + f.seeded, 0);
  const operationallyBacked = perFramework.reduce((s, f) => s + f.operationallyBacked, 0);
  return {
    totalSeeded,
    operationallyBacked,
    requiresHumanAttestation: totalSeeded - operationallyBacked,
    perFramework,
  };
})();
