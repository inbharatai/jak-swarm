// Temporal workflow definitions for JAK Swarm long-running jobs.
// These are used for durable, fault-tolerant, long-running workflows only —
// not for every agent step (those run in LangGraph in packages/swarm).
//
// Workflow categories:
//   - Batch document processing (large file sets, multi-hour runs)
//   - Scheduled report generation (daily/weekly cron jobs)
//   - Multi-day approval escalation workflows
//   - External system sync jobs (ATS, ERP, CRM batch pulls)
//
// See docs/architecture.md §Temporal for selection criteria.

export * from './workflows/batch-processing.workflow.js';
export * from './workflows/scheduled-report.workflow.js';
export * from './activities/document.activity.js';
export * from './activities/report.activity.js';
export * from './worker.js';
