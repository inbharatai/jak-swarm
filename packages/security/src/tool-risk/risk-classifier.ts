import { ToolRiskClass, RiskLevel } from '@jak-swarm/shared';
import type { ToolMetadata } from '@jak-swarm/shared';
import { RISK_LEVEL_WEIGHTS } from '@jak-swarm/shared';

/**
 * Explicit risk overrides for known tool names.
 * These override any heuristic classification.
 */
export const TOOL_RISK_OVERRIDES: Partial<Record<string, ToolRiskClass>> = {
  // Email tools
  read_email: ToolRiskClass.READ_ONLY,
  search_email: ToolRiskClass.READ_ONLY,
  list_emails: ToolRiskClass.READ_ONLY,
  draft_email: ToolRiskClass.WRITE,
  create_draft: ToolRiskClass.WRITE,
  send_email: ToolRiskClass.EXTERNAL_SIDE_EFFECT,
  send_draft: ToolRiskClass.EXTERNAL_SIDE_EFFECT,

  // Calendar tools
  list_calendar_events: ToolRiskClass.READ_ONLY,
  get_calendar_event: ToolRiskClass.READ_ONLY,
  find_availability: ToolRiskClass.READ_ONLY,
  create_calendar_event: ToolRiskClass.WRITE,
  update_calendar_event: ToolRiskClass.WRITE,
  delete_calendar_event: ToolRiskClass.DESTRUCTIVE,

  // CRM tools
  lookup_crm_contact: ToolRiskClass.READ_ONLY,
  search_crm: ToolRiskClass.READ_ONLY,
  list_crm_contacts: ToolRiskClass.READ_ONLY,
  list_crm_deals: ToolRiskClass.READ_ONLY,
  update_crm_record: ToolRiskClass.WRITE,
  create_crm_contact: ToolRiskClass.WRITE,
  create_crm_note: ToolRiskClass.WRITE,
  delete_crm_record: ToolRiskClass.DESTRUCTIVE,

  // Document tools
  read_document: ToolRiskClass.READ_ONLY,
  list_documents: ToolRiskClass.READ_ONLY,
  summarize_document: ToolRiskClass.READ_ONLY,
  extract_document_data: ToolRiskClass.READ_ONLY,
  classify_document: ToolRiskClass.READ_ONLY,
  create_document: ToolRiskClass.WRITE,
  update_document: ToolRiskClass.WRITE,
  delete_document: ToolRiskClass.DESTRUCTIVE,

  // Knowledge/search tools
  search_knowledge: ToolRiskClass.READ_ONLY,
  lookup_knowledge: ToolRiskClass.READ_ONLY,
  classify_text: ToolRiskClass.READ_ONLY,

  // Spreadsheet/reporting tools
  generate_report: ToolRiskClass.WRITE,
  create_spreadsheet: ToolRiskClass.WRITE,
  update_spreadsheet: ToolRiskClass.WRITE,

  // Browser tools
  browser_navigate: ToolRiskClass.WRITE,
  browser_extract: ToolRiskClass.READ_ONLY,
  browser_fill_form: ToolRiskClass.WRITE,
  browser_click: ToolRiskClass.WRITE,
  browser_submit: ToolRiskClass.EXTERNAL_SIDE_EFFECT,
  browser_screenshot: ToolRiskClass.READ_ONLY,

  // Payment/financial tools
  submit_payment: ToolRiskClass.DESTRUCTIVE,
  initiate_transfer: ToolRiskClass.DESTRUCTIVE,
  void_payment: ToolRiskClass.DESTRUCTIVE,

  // Record management
  delete_record: ToolRiskClass.DESTRUCTIVE,
  purge_records: ToolRiskClass.DESTRUCTIVE,
  archive_record: ToolRiskClass.WRITE,

  // External integrations
  send_webhook: ToolRiskClass.EXTERNAL_SIDE_EFFECT,
  send_sms: ToolRiskClass.EXTERNAL_SIDE_EFFECT,
  send_slack_message: ToolRiskClass.EXTERNAL_SIDE_EFFECT,

  // Access management
  revoke_access: ToolRiskClass.DESTRUCTIVE,
  grant_access: ToolRiskClass.WRITE,
};

/**
 * Classify a tool's risk class based on its name and optional metadata.
 * Applies explicit overrides first, then falls back to name-based heuristics.
 */
export function classifyToolRisk(toolName: string, metadata?: ToolMetadata): ToolRiskClass {
  // 1. Check explicit overrides
  const explicitOverride = TOOL_RISK_OVERRIDES[toolName.toLowerCase()];
  if (explicitOverride !== undefined) return explicitOverride;

  // 2. Use metadata if available
  if (metadata?.riskClass) return metadata.riskClass;

  // 3. Name-based heuristics
  const lower = toolName.toLowerCase();

  if (
    lower.includes('delete') ||
    lower.includes('destroy') ||
    lower.includes('purge') ||
    lower.includes('drop') ||
    lower.includes('payment') ||
    lower.includes('transfer') ||
    lower.includes('revoke')
  ) {
    return ToolRiskClass.DESTRUCTIVE;
  }

  if (
    lower.includes('send') ||
    lower.includes('submit') ||
    lower.includes('publish') ||
    lower.includes('webhook') ||
    lower.includes('notify')
  ) {
    return ToolRiskClass.EXTERNAL_SIDE_EFFECT;
  }

  if (
    lower.includes('create') ||
    lower.includes('update') ||
    lower.includes('write') ||
    lower.includes('set') ||
    lower.includes('add') ||
    lower.includes('insert') ||
    lower.includes('modify') ||
    lower.includes('edit') ||
    lower.includes('navigate') ||
    lower.includes('fill')
  ) {
    return ToolRiskClass.WRITE;
  }

  // Default: treat as read-only
  return ToolRiskClass.READ_ONLY;
}

/**
 * Determine whether a tool requires approval given a risk threshold.
 *
 * @param toolName - Name of the tool
 * @param threshold - The configured approval threshold (RiskLevel)
 * @param metadata - Optional tool metadata for additional context
 */
export function toolRequiresApproval(
  toolName: string,
  threshold: RiskLevel,
  metadata?: ToolMetadata,
): boolean {
  // Explicit requiresApproval in metadata always wins
  if (metadata?.requiresApproval === true) return true;
  if (metadata?.requiresApproval === false) return false;

  const riskClass = classifyToolRisk(toolName, metadata);

  // Map ToolRiskClass to equivalent RiskLevel for comparison
  const riskClassToLevel: Record<ToolRiskClass, RiskLevel> = {
    [ToolRiskClass.READ_ONLY]: RiskLevel.LOW,
    [ToolRiskClass.WRITE]: RiskLevel.MEDIUM,
    [ToolRiskClass.EXTERNAL_SIDE_EFFECT]: RiskLevel.HIGH,
    [ToolRiskClass.DESTRUCTIVE]: RiskLevel.CRITICAL,
  };

  const toolRiskLevel = riskClassToLevel[riskClass];
  return RISK_LEVEL_WEIGHTS[toolRiskLevel] >= RISK_LEVEL_WEIGHTS[threshold];
}

/**
 * Get a human-readable description of a tool's risk class.
 */
export function describeRiskClass(riskClass: ToolRiskClass): string {
  switch (riskClass) {
    case ToolRiskClass.READ_ONLY:
      return 'Read-only operation — no data modification or external side effects';
    case ToolRiskClass.WRITE:
      return 'Write operation — modifies internal data or state';
    case ToolRiskClass.EXTERNAL_SIDE_EFFECT:
      return 'External side effect — sends data outside the system or triggers external actions';
    case ToolRiskClass.DESTRUCTIVE:
      return 'Destructive operation — permanently deletes data or executes irreversible financial transactions';
  }
}
