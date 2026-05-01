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
// and restored before tools run.
export { RuntimePIIRedactor } from './guardrails/runtime-pii-redactor.js';
export type { RedactionStats } from './guardrails/runtime-pii-redactor.js';

// One-way persistence redactor (P0-B fix). Used by WorkflowService.saveTrace
// to scrub PII out of inputJson / outputJson / toolCallsJson BEFORE the
// row is written to the AgentTrace table. Replaces the prior design
// where the runtime redactor restored originals into the trace before
// persistence — original PII never reaches durable storage now.
export { redactJsonForPersistence, isPersistenceRedactionDisabled }
  from './guardrails/persistence-redactor.js';

// Local Sprint 3 — at-rest field encryption for workflow goal/error/finalOutput/
// planJson/stateJson columns. AES-256-GCM with key from JAK_FIELD_ENCRYPTION_KEY.
// Passthrough mode when no key is configured (dev default). See
// docs/workflow-pii-storage-policy.md for the design rationale.
export {
  encryptString,
  decryptString,
  encryptJson,
  decryptJson,
  isEncrypted,
  isFieldEncryptionEnabled,
  __resetFieldCipherKeyCache,
} from './encryption/field-cipher.js';

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
