import { Industry, RiskLevel, ToolCategory } from '@jak-swarm/shared';
import type { IndustryPack } from '@jak-swarm/shared';

export const retailPack: IndustryPack = {
  industry: Industry.RETAIL,
  displayName: 'Retail & E-Commerce',
  description:
    'Workflow automation for retail and e-commerce operations including customer support, inventory management, order processing, returns and refunds, promotions, and supplier communication.',
  subFunctions: [
    'Customer Support',
    'Inventory Management',
    'Order Management',
    'Returns & Refunds',
    'Promotions & Marketing',
    'Supplier Communication',
    'Product Catalog Management',
    'Fraud Detection Support',
  ],
  defaultWorkflows: [
    'process_customer_return',
    'low_inventory_alert',
    'order_status_update',
    'supplier_reorder_request',
    'promotion_campaign_draft',
    'fraud_flag_review',
  ],
  allowedTools: [
    ToolCategory.EMAIL,
    ToolCategory.CRM,
    ToolCategory.DOCUMENT,
    ToolCategory.KNOWLEDGE,
    ToolCategory.SPREADSHEET,
    ToolCategory.STORAGE,
  ],
  restrictedTools: [ToolCategory.BROWSER],
  complianceNotes: [
    'PCI-DSS: Never store, process, or log full payment card numbers',
    'Consumer data privacy: Comply with applicable state privacy laws (CCPA, etc.)',
    'Return policy must be applied consistently — document all exceptions',
    'Promotional communications require unsubscribe mechanism (CAN-SPAM)',
    'Price changes must follow pricing policy and approval thresholds',
    'Supplier communications containing pricing are commercially sensitive — restrict access',
  ],
  agentPromptSupplement: `RETAIL OPERATIONS CONTEXT:
You are supporting retail and e-commerce operations.

KEY RULES:
1. PAYMENT DATA: Never include full credit card numbers, CVVs, or bank account numbers in any output, log, or communication. Truncate to last 4 digits only.
2. RETURN PROCESSING: Always verify return eligibility against current policy before initiating. Flag out-of-policy returns for supervisor approval.
3. INVENTORY ACTIONS: Inventory adjustments above the configured threshold require manager approval before execution.
4. CUSTOMER DATA: Customer PII (email, address, phone, purchase history) should only be accessed for the specific task at hand.
5. PRICING: Never change prices or apply discounts beyond configured approval thresholds without manager sign-off.
6. SUPPLIER RELATIONS: Supplier pricing and contract terms are confidential — do not share across accounts or include in customer-facing communications.
7. FRAUD PATTERNS: Flag orders matching fraud indicators (unusual quantities, multiple cards, shipping/billing mismatch) for human review.`,
  recommendedApprovalThreshold: RiskLevel.HIGH,
  defaultKPITemplates: [
    'order_processing_time',
    'return_rate',
    'customer_satisfaction_score',
    'inventory_accuracy',
    'supplier_on_time_delivery',
    'promotion_redemption_rate',
  ],
  policyOverlays: [
    {
      name: 'PCI-DSS Payment Data Protection',
      rule: 'Payment card data must never appear in logs, emails, or messages. Always tokenize or truncate.',
      enforcement: 'BLOCK',
      appliesTo: [ToolCategory.EMAIL, ToolCategory.MESSAGING, ToolCategory.WEBHOOK],
    },
    {
      name: 'Promotional Communication Compliance',
      rule: 'Marketing emails must include unsubscribe link and physical address per CAN-SPAM requirements',
      enforcement: 'WARN',
      appliesTo: [ToolCategory.EMAIL, ToolCategory.MESSAGING],
    },
  ],
};
