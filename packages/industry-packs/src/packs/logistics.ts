import { Industry, RiskLevel, ToolCategory } from '@jak-swarm/shared';
import type { IndustryPack } from '@jak-swarm/shared';

export const logisticsPack: IndustryPack = {
  industry: Industry.LOGISTICS,
  displayName: 'Logistics & Supply Chain',
  description:
    'Workflow automation for logistics and supply chain operations including shipment tracking, delay notifications, route optimization planning, client updates, daily operational reports, and carrier communication.',
  subFunctions: [
    'Shipment Tracking',
    'Delay Notification',
    'Route Optimization Planning',
    'Client Updates',
    'Daily Operations Report',
    'Carrier Communication',
    'Customs Documentation',
    'Exception Management',
  ],
  defaultWorkflows: [
    'shipment_delay_alert',
    'daily_ops_report',
    'carrier_performance_summary',
    'customs_doc_checklist',
    'client_status_update_batch',
    'exception_escalation',
  ],
  allowedTools: [
    ToolCategory.EMAIL,
    ToolCategory.DOCUMENT,
    ToolCategory.SPREADSHEET,
    ToolCategory.KNOWLEDGE,
    ToolCategory.STORAGE,
    ToolCategory.CALENDAR,
  ],
  restrictedTools: [ToolCategory.WEBHOOK, ToolCategory.BROWSER],
  complianceNotes: [
    'Customs documentation must be accurate — false declarations have legal consequences',
    'Hazardous materials classification requires specialist verification before shipping',
    'Client SLA breach notifications must be sent within defined windows',
    'Carrier contracts contain confidentiality clauses — do not share rate cards externally',
    'International shipment data may be subject to export control regulations',
  ],
  agentPromptSupplement: `LOGISTICS OPERATIONS CONTEXT:
You are supporting logistics and supply chain operations.

KEY RULES:
1. SHIPMENT DATA ACCURACY: Shipment weights, dimensions, and HS codes must be accurate. Errors cause delays and penalties. Flag any discrepancies for verification.
2. DELAY NOTIFICATIONS: Client delay notifications must be sent within the contractual SLA window. Include estimated new delivery date and reason code.
3. HAZMAT: Any shipment involving hazardous materials must be flagged for specialist review. Never autonomously reclassify hazmat status.
4. CUSTOMS: Customs documentation requires human verification before submission. Never auto-submit customs declarations.
5. CARRIER DATA: Carrier rate cards and contract terms are confidential. Do not include in client-facing communications.
6. EXCEPTION ESCALATION: Shipments with exceptions (lost, damaged, held at customs) must be escalated to account managers within 2 hours.
7. DATA ACCURACY: All tracking events must be timestamped accurately. Never estimate or fabricate tracking updates.`,
  recommendedApprovalThreshold: RiskLevel.HIGH,
  defaultKPITemplates: [
    'on_time_delivery_rate',
    'average_transit_time',
    'exception_rate',
    'client_notification_timeliness',
    'carrier_performance_score',
    'customs_clearance_time',
  ],
  policyOverlays: [
    {
      name: 'Carrier Contract Confidentiality',
      rule: 'Carrier rate cards and contractual terms must not be included in client or external communications',
      enforcement: 'BLOCK',
      appliesTo: [ToolCategory.EMAIL, ToolCategory.MESSAGING],
    },
    {
      name: 'Customs Document Control',
      rule: 'Customs declarations and shipping documents must be reviewed by a qualified person before submission to authorities',
      enforcement: 'WARN',
      appliesTo: [ToolCategory.DOCUMENT, ToolCategory.WEBHOOK],
    },
  ],
};
