import { Industry, RiskLevel, ToolCategory } from '@jak-swarm/shared';
import type { IndustryPack } from '@jak-swarm/shared';

export const insurancePack: IndustryPack = {
  industry: Industry.INSURANCE,
  displayName: 'Insurance Operations',
  description:
    'Workflow automation for insurance operations including claims intake, policy lookup, adjudication support, client communication, fraud flagging, and regulatory reporting.',
  subFunctions: [
    'Claims Intake',
    'Policy Lookup',
    'Adjudication Support',
    'Client Communication',
    'Fraud Flagging',
    'Regulatory Reporting',
    'Underwriting Support',
    'Renewal Processing',
  ],
  defaultWorkflows: [
    'new_claim_intake',
    'fraud_indicator_check',
    'policy_renewal_reminder',
    'adjudication_summary',
    'regulatory_report_prep',
    'client_status_update',
  ],
  allowedTools: [
    ToolCategory.EMAIL,
    ToolCategory.DOCUMENT,
    ToolCategory.KNOWLEDGE,
    ToolCategory.STORAGE,
    ToolCategory.SPREADSHEET,
  ],
  restrictedTools: [ToolCategory.WEBHOOK, ToolCategory.BROWSER],
  complianceNotes: [
    'State insurance regulations vary — confirm jurisdiction before processing',
    'Claims decisions require licensed adjuster review — AI provides support only',
    'Policyholder data is sensitive — comply with applicable privacy laws',
    'Bad faith claims handling has significant legal exposure — document all decisions',
    'Fraud referrals require documented suspicious indicators before filing',
    'Reserve changes above threshold require actuarial and management approval',
    'Regulatory filings have strict deadlines — flag pending submissions in advance',
  ],
  agentPromptSupplement: `INSURANCE OPERATIONS CONTEXT:
You are supporting insurance operations.

CRITICAL RULES:
1. CLAIMS DECISIONS: You NEVER make final claims decisions. Your role is to gather information, summarize, and route to licensed adjusters. Always flag that final determination requires human review.
2. FRAUD INDICATORS: Document specific, objective indicators when flagging potential fraud. Never allege fraud without documented evidence. Route to Special Investigations Unit (SIU).
3. POLICYHOLDER PRIVACY: Policy numbers, coverage details, and claim information are sensitive. Verify recipient authorization before sharing.
4. COVERAGE DETERMINATION: Coverage questions must be answered by reviewing the actual policy language. Never interpret coverage based on assumptions.
5. BAD FAITH PREVENTION: Ensure all claim communications are timely, acknowledge receipt, and document all decisions with reasoning.
6. REGULATORY DEADLINES: Claims acknowledgment typically required within 10 business days; resolution or explanation within 30-45 days depending on jurisdiction.
7. RESERVE SETTING: Reserve recommendations require actuarial validation. Flag for human review.`,
  recommendedApprovalThreshold: RiskLevel.MEDIUM,
  defaultKPITemplates: [
    'claim_intake_processing_time',
    'fraud_detection_rate',
    'client_communication_timeliness',
    'adjudication_cycle_time',
    'regulatory_filing_on_time_rate',
    'reserve_accuracy',
  ],
  policyOverlays: [
    {
      name: 'Claims Decision Authority',
      rule: 'Automated systems may not issue final claims decisions. All determinations require licensed adjuster approval.',
      enforcement: 'BLOCK',
      appliesTo: [ToolCategory.EMAIL, ToolCategory.DOCUMENT],
    },
    {
      name: 'Fraud Investigation Confidentiality',
      rule: 'Fraud investigation details must not be communicated to the insured while investigation is active',
      enforcement: 'BLOCK',
      appliesTo: [ToolCategory.EMAIL, ToolCategory.MESSAGING],
    },
  ],
};
