import { Industry, RiskLevel, ToolCategory } from '@jak-swarm/shared';
import type { IndustryPack } from '@jak-swarm/shared';

export const hospitalityPack: IndustryPack = {
  industry: Industry.HOSPITALITY,
  displayName: 'Hospitality & Travel',
  description:
    'Workflow automation for hospitality and travel operations including guest communication, reservation management, complaint handling, review response, housekeeping coordination, and revenue reporting.',
  subFunctions: [
    'Guest Communication',
    'Reservation Management',
    'Complaint Handling',
    'Review Response',
    'Housekeeping Coordination',
    'Revenue Reporting',
    'F&B Operations',
    'Event Coordination',
  ],
  defaultWorkflows: [
    'guest_pre_arrival_message',
    'complaint_intake_and_route',
    'review_response_draft',
    'daily_revenue_report',
    'housekeeping_schedule',
    'checkout_followup_survey',
  ],
  allowedTools: [
    ToolCategory.EMAIL,
    ToolCategory.CALENDAR,
    ToolCategory.DOCUMENT,
    ToolCategory.KNOWLEDGE,
    ToolCategory.SPREADSHEET,
    ToolCategory.STORAGE,
  ],
  restrictedTools: [ToolCategory.WEBHOOK, ToolCategory.BROWSER],
  complianceNotes: [
    'Guest privacy: Personal stay information is confidential — do not share with third parties',
    'Public review responses are brand-representing — require approval before posting',
    'Complaint handling: Document all complaints and resolutions for risk management',
    'Revenue data is competitively sensitive — restrict access to authorized personnel',
    'Guest payment methods must never be stored or transmitted without PCI compliance',
    'Accessibility: Guest communications must be available in accessible formats on request',
  ],
  agentPromptSupplement: `HOSPITALITY OPERATIONS CONTEXT:
You are supporting hospitality and travel operations where guest experience is paramount.

KEY RULES:
1. GUEST PRIVACY: Guest names, stay dates, room numbers, and personal preferences are confidential. Do not share across guests or with unauthorized staff.
2. COMPLAINT ESCALATION: Complaints about safety, discrimination, or legal matters must be escalated to management immediately — do not attempt to resolve independently.
3. REVIEW RESPONSES: Public review responses represent the brand. Keep responses professional, empathetic, and never defensive. All public responses require manager approval.
4. COMPENSATION: Compensation offers (upgrades, refunds, credits) must stay within configured authorization limits. Escalate requests above limits to manager.
5. PAYMENT DATA: Never store or transmit full payment card details. Reference reservation or masked last-4 only.
6. TONE: Maintain a warm, professional hospitality tone in all guest communications. Personalize where possible using available preference data.
7. REVENUE DATA: RevPAR, ADR, and occupancy data are competitively sensitive. Restrict to authorized internal users.`,
  recommendedApprovalThreshold: RiskLevel.MEDIUM,
  defaultKPITemplates: [
    'guest_satisfaction_score',
    'complaint_resolution_time',
    'review_response_rate',
    'revenue_per_available_room',
    'average_daily_rate',
    'housekeeping_turnaround_time',
  ],
  policyOverlays: [
    {
      name: 'Public Review Response Approval',
      rule: 'All responses to public guest reviews (TripAdvisor, Google, Yelp) must be approved by a manager before posting',
      enforcement: 'WARN',
      appliesTo: [ToolCategory.EMAIL, ToolCategory.MESSAGING],
    },
    {
      name: 'Guest Data Privacy',
      rule: 'Guest stay information and personal data must not be shared with third parties without explicit consent',
      enforcement: 'BLOCK',
      appliesTo: [ToolCategory.EMAIL, ToolCategory.WEBHOOK, ToolCategory.MESSAGING],
    },
  ],
};
