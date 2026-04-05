import { Industry, RiskLevel, ToolCategory } from '@jak-swarm/shared';
import type { IndustryPack } from '@jak-swarm/shared';

export const financePack: IndustryPack = {
  industry: Industry.FINANCE,
  displayName: 'Finance & Accounting Operations',
  description:
    'Workflow automation for finance and accounting operations including invoice processing, accounts payable/receivable, expense management, approval workflows, reconciliation, and audit preparation. SOX-relevant controls enforced.',
  subFunctions: [
    'Invoice Processing',
    'Accounts Payable',
    'Accounts Receivable',
    'Expense Management',
    'Approval Workflows',
    'Reconciliation',
    'Audit Preparation',
    'Budget Reporting',
    'Vendor Management',
  ],
  defaultWorkflows: [
    'process_invoice',
    'expense_approval_routing',
    'monthly_reconciliation',
    'audit_trail_export',
    'vendor_payment_batch',
    'budget_variance_report',
  ],
  allowedTools: [
    ToolCategory.EMAIL,
    ToolCategory.DOCUMENT,
    ToolCategory.SPREADSHEET,
    ToolCategory.KNOWLEDGE,
    ToolCategory.STORAGE,
  ],
  restrictedTools: [ToolCategory.WEBHOOK, ToolCategory.BROWSER, ToolCategory.CRM],
  complianceNotes: [
    'SOX Section 302/906: Management certifications require accurate financial reporting',
    'SOX Section 404: Internal controls over financial reporting must be documented and tested',
    'Segregation of duties: The same person cannot approve and execute financial transactions',
    'All financial transactions above materiality threshold require dual approval',
    'Audit trail: All financial record modifications must be logged with timestamp and user ID',
    'Vendor master changes require independent verification before payment release',
    'Bank account details are highly sensitive — restrict access and never include in logs',
    'Month-end close procedures must follow documented sequence — no shortcuts',
  ],
  agentPromptSupplement: `FINANCE & SOX COMPLIANCE CONTEXT:
You are operating within a finance department subject to SOX controls.

CRITICAL SOX CONTROL RULES:
1. SEGREGATION OF DUTIES: Never allow the same individual (or automated process acting on behalf of one role) to both initiate AND approve a financial transaction. Flag segregation violations immediately.
2. DUAL APPROVAL: All transactions above $[configured threshold] require TWO authorized approvers. One approval is insufficient.
3. AUDIT TRAIL: Every financial record modification must be traceable. Include: who made the change, when, what was changed, and the business justification.
4. BANK DATA PROTECTION: Bank account numbers, routing numbers, and payment credentials must never appear in emails, reports, or logs. Mask all but last 4 digits.
5. VENDOR VERIFICATION: Before processing any payment to a new or changed vendor, verify bank details through an independent channel. Never trust email-only bank change requests.
6. PERIOD CLOSE: Do not post entries to a closed accounting period without CFO-level approval. Flag any attempt.
7. MATERIALITY: Errors above materiality threshold (typically 5% of pre-tax income or as configured) must be escalated to finance leadership and potentially disclosed.
8. INVOICE VALIDATION: Validate invoice amounts, vendor IDs, and PO references before routing for approval. Three-way match preferred.

All WRITE operations on financial records automatically require human approval regardless of risk level.`,
  recommendedApprovalThreshold: RiskLevel.LOW,
  defaultKPITemplates: [
    'invoice_processing_time',
    'payment_accuracy_rate',
    'reconciliation_exception_count',
    'audit_finding_count',
    'expense_approval_cycle_time',
    'vendor_payment_on_time_rate',
  ],
  policyOverlays: [
    {
      name: 'SOX Segregation of Duties',
      rule: 'The initiator of a financial transaction must not be the same as the approver. System enforces dual control on all WRITE financial operations.',
      enforcement: 'BLOCK',
      appliesTo: [ToolCategory.DOCUMENT, ToolCategory.SPREADSHEET, ToolCategory.STORAGE],
    },
    {
      name: 'Financial Data Confidentiality',
      rule: 'Bank account details, payment credentials, and material non-public financial information must not be transmitted via email or messaging without encryption',
      enforcement: 'BLOCK',
      appliesTo: [ToolCategory.EMAIL, ToolCategory.MESSAGING, ToolCategory.WEBHOOK],
    },
    {
      name: 'Vendor Payment Verification',
      rule: 'New vendor or changed bank details require independent verification before payment execution',
      enforcement: 'WARN',
      appliesTo: [ToolCategory.EMAIL, ToolCategory.DOCUMENT],
    },
  ],
};
