import { Industry, RiskLevel, ToolCategory } from '@jak-swarm/shared';
import type { IndustryPack } from '@jak-swarm/shared';

export const generalPack: IndustryPack = {
  industry: Industry.GENERAL,
  displayName: 'General Purpose',
  description:
    'Default general-purpose pack with minimal tool restrictions. Used when no specific industry context is detected. Applies conservative defaults.',
  subFunctions: [
    'Task Automation',
    'Information Retrieval',
    'Document Processing',
    'Communication',
    'Scheduling',
    'Reporting',
  ],
  defaultWorkflows: [
    'general_task',
    'information_lookup',
    'document_summary',
    'draft_communication',
  ],
  allowedTools: [
    ToolCategory.EMAIL,
    ToolCategory.CALENDAR,
    ToolCategory.DOCUMENT,
    ToolCategory.KNOWLEDGE,
    ToolCategory.SPREADSHEET,
  ],
  restrictedTools: [
    ToolCategory.BROWSER,
    ToolCategory.WEBHOOK,
    ToolCategory.CRM,
  ],
  complianceNotes: [
    'General purpose mode applies conservative defaults',
    'No industry-specific compliance overlays — apply organizational policies',
    'All external communications require human review',
    'Data minimization principle applies',
  ],
  agentPromptSupplement: `GENERAL PURPOSE CONTEXT:
You are operating in general-purpose mode without a specific industry context.

Apply conservative defaults:
1. Flag any action with external side effects for human review
2. Do not make assumptions about compliance requirements — ask when uncertain
3. Minimize data access to only what is needed for the task
4. All external communications should be drafted for human review before sending`,
  recommendedApprovalThreshold: RiskLevel.HIGH,
  defaultKPITemplates: ['task_completion_rate', 'error_rate', 'processing_time'],
  policyOverlays: [
    {
      name: 'External Communication Review',
      rule: 'All external communications in general mode require human review before sending',
      enforcement: 'WARN',
      appliesTo: [ToolCategory.EMAIL, ToolCategory.MESSAGING, ToolCategory.WEBHOOK],
    },
  ],
};
