import { Industry, RiskLevel, ToolCategory } from '@jak-swarm/shared';
import type { IndustryPack } from '@jak-swarm/shared';

export const customerSupportPack: IndustryPack = {
  industry: Industry.CUSTOMER_SUPPORT,
  displayName: 'Customer Support & BPO',
  description:
    'Workflow automation for customer support and BPO operations including ticket classification, response drafting, escalation routing, knowledge base lookup, SLA tracking, and daily reporting.',
  subFunctions: [
    'Ticket Classification',
    'Response Drafting',
    'Escalation Routing',
    'Knowledge Base Lookup',
    'SLA Tracking',
    'Daily Reporting',
    'Quality Assurance',
    'Agent Coaching',
  ],
  defaultWorkflows: [
    'classify_and_route_ticket',
    'draft_response_from_kb',
    'sla_breach_alert',
    'daily_queue_report',
    'escalation_handoff',
    'quality_sample_review',
  ],
  allowedTools: [
    ToolCategory.EMAIL,
    ToolCategory.DOCUMENT,
    ToolCategory.KNOWLEDGE,
    ToolCategory.SPREADSHEET,
    ToolCategory.STORAGE,
    ToolCategory.CRM,
  ],
  restrictedTools: [ToolCategory.WEBHOOK, ToolCategory.BROWSER],
  complianceNotes: [
    'Customer data used for support must not be repurposed for marketing without consent',
    'SLA commitments must be tracked and breaches documented for client reporting',
    'Escalation to human agents required for: legal threats, safety concerns, media mentions',
    'Call/chat recordings may be subject to consent laws — verify jurisdiction',
    'Quality sampling and monitoring must comply with employee privacy laws',
    'Client-specific style guides and response templates must be followed',
  ],
  agentPromptSupplement: `CUSTOMER SUPPORT OPERATIONS CONTEXT:
You are supporting customer service and BPO operations.

KEY RULES:
1. ESCALATION TRIGGERS: Immediately escalate to a human agent for: legal threats, safety concerns, mentions of media/regulator, requests for supervisor, account closures above threshold, fraud claims.
2. EMPATHY FIRST: Acknowledge the customer's issue before providing solutions. A frustrated customer needs to feel heard before receiving information.
3. KNOWLEDGE BASE ACCURACY: Only use verified knowledge base content in responses. Never invent product specifications, policies, or promises.
4. RESPONSE QUALITY: Responses must be: clear, concise, complete, correct, and consistent with brand voice. Proofread before sending.
5. SLA AWARENESS: Always check ticket age against SLA requirements. Flag tickets approaching breach thresholds.
6. DATA MINIMIZATION: Collect only the minimum customer data needed to resolve the issue.
7. TONE CALIBRATION: Match formality to the communication channel and customer tone. Avoid jargon, abbreviations, or overly casual language.
8. FIRST CONTACT RESOLUTION: Aim to resolve in first contact. If not possible, provide clear next steps and realistic timeline.`,
  recommendedApprovalThreshold: RiskLevel.HIGH,
  defaultKPITemplates: [
    'first_contact_resolution_rate',
    'average_handle_time',
    'customer_satisfaction_csat',
    'net_promoter_score',
    'sla_compliance_rate',
    'escalation_rate',
    'queue_backlog',
  ],
  policyOverlays: [
    {
      name: 'Legal Threat Escalation',
      rule: 'Any customer communication containing legal threats, regulatory complaints, or media mentions must be immediately escalated to a supervisor and not responded to by automated systems',
      enforcement: 'BLOCK',
      appliesTo: [ToolCategory.EMAIL, ToolCategory.MESSAGING],
    },
    {
      name: 'Response Quality Gate',
      rule: 'Automated draft responses must be reviewed by a human agent before sending on sensitive topics (refunds above threshold, account closures, complaints)',
      enforcement: 'WARN',
      appliesTo: [ToolCategory.EMAIL, ToolCategory.MESSAGING],
    },
  ],
};
