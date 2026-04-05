import { Industry, RiskLevel, ToolCategory } from '@jak-swarm/shared';
import type { IndustryPack } from '@jak-swarm/shared';

export const legalPack: IndustryPack = {
  industry: Industry.LEGAL,
  displayName: 'Legal Operations',
  description:
    'Workflow automation for legal operations including document review, contract analysis, deadline tracking, client communication, matter management, and billing. Attorney-client privilege considerations enforced.',
  subFunctions: [
    'Document Review',
    'Contract Analysis',
    'Deadline Tracking',
    'Client Communication',
    'Matter Management',
    'Billing & Timekeeping',
    'Regulatory Compliance Monitoring',
    'Discovery Support',
  ],
  defaultWorkflows: [
    'contract_review_intake',
    'deadline_calendar_sync',
    'client_status_report',
    'billing_review_draft',
    'matter_opening_checklist',
    'discovery_document_triage',
  ],
  allowedTools: [
    ToolCategory.EMAIL,
    ToolCategory.DOCUMENT,
    ToolCategory.CALENDAR,
    ToolCategory.KNOWLEDGE,
    ToolCategory.STORAGE,
    ToolCategory.SPREADSHEET,
  ],
  restrictedTools: [ToolCategory.WEBHOOK, ToolCategory.BROWSER, ToolCategory.CRM],
  complianceNotes: [
    'Attorney-client privilege: Communications with counsel are privileged and must not be disclosed',
    'Work product doctrine: Litigation strategy documents have heightened protection',
    'Conflicts of interest: New matters must be conflict-checked before engagement',
    'Unauthorized practice of law: AI may assist but not provide legal advice independently',
    'Client confidentiality: All client information is confidential under professional conduct rules',
    'Deadline management is critical: missed court deadlines can result in sanctions or malpractice',
    'Billing guidelines compliance: Client billing requirements must be followed precisely',
    'Document retention: Legal holds supersede routine deletion policies',
  ],
  agentPromptSupplement: `LEGAL OPERATIONS CONTEXT:
You are supporting legal operations subject to attorney-client privilege and professional conduct rules.

CRITICAL RULES:
1. PRIVILEGE: All communications between attorney and client are potentially privileged. Never include privileged communications in non-privileged channels. Always mark privileged documents accordingly.
2. NO LEGAL ADVICE: You assist with legal operations but do not provide legal advice or legal opinions. Always route substantive legal questions to licensed attorneys.
3. CONFIDENTIALITY: Client identity and matter details are confidential. Do not discuss one client's matters with individuals working on other matters without explicit authorization.
4. CONFLICTS: Before any new matter communication, confirm conflicts clearance has been completed.
5. DEADLINES: Court filing deadlines, statute of limitations, and regulatory deadlines are critical. Flag any approaching deadlines (within 30 days) for immediate attorney review. Never assume extension availability.
6. BILLING: Time entries must be accurate and contemporaneous. Do not create or modify billing entries without attorney authorization.
7. EXTERNAL COMMUNICATIONS: ALL external communications to opposing counsel, courts, or clients require attorney review before sending.
8. DISCOVERY HOLDS: If a legal hold is in effect for a matter, flag any document deletion requests for Legal Ops review.`,
  recommendedApprovalThreshold: RiskLevel.LOW,
  defaultKPITemplates: [
    'matter_cycle_time',
    'deadline_compliance_rate',
    'billing_realization_rate',
    'client_communication_turnaround',
    'document_review_throughput',
    'conflict_check_turnaround',
  ],
  policyOverlays: [
    {
      name: 'External Communication Approval',
      rule: 'All external communications (client, opposing counsel, courts, regulators) must be reviewed and approved by a licensed attorney before sending',
      enforcement: 'BLOCK',
      appliesTo: [ToolCategory.EMAIL, ToolCategory.MESSAGING, ToolCategory.WEBHOOK],
    },
    {
      name: 'Attorney-Client Privilege Protection',
      rule: 'Privileged communications must not be stored in non-privileged systems, included in non-privileged emails, or shared with unauthorized parties',
      enforcement: 'BLOCK',
      appliesTo: [ToolCategory.EMAIL, ToolCategory.STORAGE, ToolCategory.DOCUMENT],
    },
    {
      name: 'Legal Hold Compliance',
      rule: 'When a legal hold is active for a matter, document deletion or modification requires Legal Ops approval',
      enforcement: 'WARN',
      appliesTo: [ToolCategory.DOCUMENT, ToolCategory.STORAGE],
    },
  ],
};
