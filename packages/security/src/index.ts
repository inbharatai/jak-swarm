// RBAC
export { Permissions, ROLE_PERMISSIONS, RISK_APPROVAL_ROLE } from './rbac/roles.js';
export type { Permission } from './rbac/roles.js';
export { PolicyEngine, policyEngine } from './rbac/policy-engine.js';

// PII Detection
export {
  PIIType,
  detectPII,
  containsPII,
  redactPII,
  containsPHI,
} from './guardrails/pii-detector.js';
export type { PIIMatch, PIIDetectionResult } from './guardrails/pii-detector.js';

// Runtime PII redaction (Sprint 2.4 / Item G) — wraps detectPII with a
// placeholder-restoration layer so PII can be redacted before LLM calls
// and restored before the trace is persisted.
export { RuntimePIIRedactor } from './guardrails/runtime-pii-redactor.js';
export type { RedactionStats } from './guardrails/runtime-pii-redactor.js';

// Injection Detection
export { detectInjection, isInjectionAttempt } from './guardrails/injection-detector.js';
export type { InjectionDetectionResult } from './guardrails/injection-detector.js';

// Audit Logging
export {
  AuditAction,
  AuditLogger,
  createNullAuditLogger,
} from './audit/audit-log.js';
export type {
  AuditEvent,
  AuditLogEntry,
  AuditPrismaClient,
} from './audit/audit-log.js';

// Tool Risk Classification
export {
  TOOL_RISK_OVERRIDES,
  classifyToolRisk,
  toolRequiresApproval,
  describeRiskClass,
} from './tool-risk/risk-classifier.js';
