import { Industry, RiskLevel, ToolCategory } from '@jak-swarm/shared';
import type { IndustryPack } from '@jak-swarm/shared';

export const healthcarePack: IndustryPack = {
  industry: Industry.HEALTHCARE,
  displayName: 'Healthcare Administration',
  description:
    'Workflow automation for healthcare organizations including patient intake, claims processing, prior authorization, scheduling, and compliance reporting. All actions subject to HIPAA compliance requirements.',
  subFunctions: [
    'Patient Intake',
    'Claims Processing',
    'Prior Authorization',
    'Billing & Coding',
    'Scheduling',
    'Document Management',
    'Compliance Reporting',
  ],
  defaultWorkflows: [
    'process_intake_form',
    'route_claims_issue',
    'flag_human_review',
    'generate_daily_ops_report',
    'prior_auth_status_check',
    'appointment_reminder_batch',
  ],
  allowedTools: [
    ToolCategory.EMAIL,
    ToolCategory.CALENDAR,
    ToolCategory.DOCUMENT,
    ToolCategory.KNOWLEDGE,
    ToolCategory.STORAGE,
  ],
  restrictedTools: [ToolCategory.WEBHOOK],
  complianceNotes: [
    'HIPAA minimum necessary principle applies — access only what is required for the specific task',
    'PHI (Protected Health Information) must not be logged verbatim in system logs',
    'All actions on patient records require a complete audit trail',
    'Automated communications to patients must include HIPAA disclosure language',
    'De-identification required before any data sharing or analytics tasks',
    'Business Associate Agreement (BAA) required for all third-party integrations',
    'Right of access requests must be fulfilled within 30 days per HIPAA §164.524',
  ],
  agentPromptSupplement: `HEALTHCARE COMPLIANCE CONTEXT:
You are operating within a HIPAA-covered healthcare organization.

CRITICAL RULES:
1. MINIMUM NECESSARY: Only access, process, or transmit the minimum PHI necessary for the specific task. Do not pull full patient records when only a date is needed.
2. PHI PROTECTION: Never include the following in logs, external messages, or outputs without explicit approval: patient names, dates of birth, SSNs, MRNs, addresses, phone numbers, diagnoses, treatment information, insurance IDs.
3. AUDIT TRAIL: Every action on a patient record must be traceable. Always include the purpose of access in your reasoning.
4. PATIENT COMMUNICATION: Any automated messages sent to patients must include the disclosure: "This message is for [patient name] only and may contain protected health information."
5. DE-IDENTIFICATION: When performing analytics or sharing data, apply Safe Harbor de-identification (remove all 18 HIPAA identifiers) before processing.
6. PRIOR AUTHORIZATION: Flag any request that modifies treatment authorizations for immediate human review.
7. BREACH RISK: If you detect potential unauthorized access or unusual data patterns, immediately flag for compliance review.

When uncertain about whether an action is HIPAA-compliant, choose the more restrictive interpretation and escalate to a human reviewer.`,
  recommendedApprovalThreshold: RiskLevel.MEDIUM,
  defaultKPITemplates: [
    'intake_volume',
    'claims_processing_time',
    'error_rate',
    'pending_reviews',
    'prior_auth_turnaround_hours',
    'patient_satisfaction_score',
  ],
  policyOverlays: [
    {
      name: 'PHI Protection',
      rule: 'Never include patient identifiers (name, DOB, SSN, MRN, diagnosis) in logs, external messages, or webhook payloads without explicit HIPAA-compliant approval',
      enforcement: 'BLOCK',
      appliesTo: [ToolCategory.EMAIL, ToolCategory.MESSAGING, ToolCategory.WEBHOOK],
    },
    {
      name: 'Audit Trail Enforcement',
      rule: 'All document read/write operations on patient records must be accompanied by a documented purpose of access',
      enforcement: 'WARN',
      appliesTo: [ToolCategory.DOCUMENT, ToolCategory.STORAGE],
    },
    {
      name: 'External Communication Disclosure',
      rule: 'Automated patient communications must include HIPAA disclosure language and opt-out instructions',
      enforcement: 'WARN',
      appliesTo: [ToolCategory.EMAIL, ToolCategory.MESSAGING],
    },
  ],
};
