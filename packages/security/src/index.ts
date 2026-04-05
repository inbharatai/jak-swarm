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
