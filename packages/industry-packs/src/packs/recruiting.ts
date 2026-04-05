import { Industry, RiskLevel, ToolCategory } from '@jak-swarm/shared';
import type { IndustryPack } from '@jak-swarm/shared';

export const recruitingPack: IndustryPack = {
  industry: Industry.RECRUITING,
  displayName: 'Recruiting & Human Resources',
  description:
    'Workflow automation for recruiting and HR operations including resume screening, candidate shortlisting, interview scheduling, ATS updates, offer letter drafting, and onboarding coordination.',
  subFunctions: [
    'Resume Screening',
    'Candidate Shortlisting',
    'Interview Scheduling',
    'ATS Updates',
    'Offer Letter Drafting',
    'Onboarding Coordination',
    'Background Check Coordination',
    'Candidate Communication',
  ],
  defaultWorkflows: [
    'screen_resume_batch',
    'schedule_interview_panel',
    'draft_offer_letter',
    'onboarding_checklist',
    'candidate_status_update',
    'rejection_communication',
  ],
  allowedTools: [
    ToolCategory.EMAIL,
    ToolCategory.CALENDAR,
    ToolCategory.DOCUMENT,
    ToolCategory.KNOWLEDGE,
    ToolCategory.STORAGE,
  ],
  restrictedTools: [ToolCategory.CRM, ToolCategory.WEBHOOK],
  complianceNotes: [
    'Equal Employment Opportunity (EEO): Screening criteria must be job-related and consistent',
    'EEOC guidelines prohibit screening on protected characteristics (race, religion, sex, national origin, age, disability)',
    'GDPR/CCPA: Candidate data must be retained per privacy policy and deleted upon request',
    'Background check requirements vary by role and jurisdiction — verify before initiating',
    'Offer letters for employees with equity must be reviewed by legal before sending',
    'Salary information may be subject to pay transparency laws in some jurisdictions',
    'Interview notes are discoverable — instruct interviewers on appropriate documentation',
  ],
  agentPromptSupplement: `RECRUITING & HR COMPLIANCE CONTEXT:
You are supporting recruiting and HR operations subject to employment law.

CRITICAL RULES:
1. BIAS PREVENTION: Screen and shortlist candidates ONLY on job-relevant qualifications. Never factor in or infer: age, race, gender, religion, national origin, disability status, pregnancy, or other protected characteristics.
2. CONSISTENT CRITERIA: Apply the same evaluation criteria to all candidates for the same role. Document your criteria before scoring.
3. CANDIDATE DATA PRIVACY: Candidate resumes and personal information must only be used for recruiting purposes. Do not share across roles without consent.
4. OFFER LETTER REVIEW: Offer letters must match approved compensation bands. Letters with equity or unusual terms require Legal review before sending.
5. REJECTION COMMUNICATIONS: Keep rejection communications professional and concise. Do not include specific feedback without HR approval.
6. BACKGROUND CHECKS: Only initiate background checks after conditional offer acceptance and with candidate written consent.
7. SALARY HISTORY: Do not ask for or use salary history where prohibited by local law.`,
  recommendedApprovalThreshold: RiskLevel.MEDIUM,
  defaultKPITemplates: [
    'time_to_fill',
    'time_to_hire',
    'offer_acceptance_rate',
    'interview_to_offer_ratio',
    'source_of_hire',
    'candidate_pipeline_diversity',
  ],
  policyOverlays: [
    {
      name: 'EEO Bias Prevention',
      rule: 'Screening and shortlisting criteria must be documented and job-related. Protected characteristics must not influence candidate evaluations.',
      enforcement: 'BLOCK',
      appliesTo: [ToolCategory.DOCUMENT, ToolCategory.EMAIL],
    },
    {
      name: 'Offer Letter Control',
      rule: 'Offer letters must not be sent without HR and (for equity grants) Legal review and approval',
      enforcement: 'WARN',
      appliesTo: [ToolCategory.EMAIL, ToolCategory.DOCUMENT],
    },
  ],
};
