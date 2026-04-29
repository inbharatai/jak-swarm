/**
 * Domain-specific error classes used across the API.
 * All errors carry an HTTP status code and a machine-readable code string.
 */

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    // Preserve prototype chain in compiled JS
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      404,
      'NOT_FOUND',
      id ? `${resource} with id '${id}' not found` : `${resource} not found`,
    );
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(403, 'FORBIDDEN', message);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(422, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class TenantIsolationError extends AppError {
  constructor() {
    super(403, 'TENANT_ISOLATION_VIOLATION', 'Access to resource in another tenant is not allowed');
    this.name = 'TenantIsolationError';
  }
}

export class WorkflowStateError extends AppError {
  constructor(message: string) {
    super(409, 'WORKFLOW_STATE_ERROR', message);
    this.name = 'WorkflowStateError';
  }
}

/**
 * Approval payload-binding violation — Item B of the OpenClaw-inspired
 * Phase 1. Raised when the canonical hash of an approval's proposedData
 * at decide-time differs from the hash captured at create-time.
 *
 * In practice this means the proposedData was mutated between create
 * and decide (whether via a buggy code path or a tampered DB row). The
 * approver may have looked at one payload and unintentionally approved
 * a different one, so the route layer rejects the decision rather than
 * letting the resume proceed under stale assumptions.
 *
 * The 409 status keeps the `WorkflowStateError` peer's HTTP shape;
 * `details.expectedHash` + `details.observedHash` give operators the
 * forensic context to diff what changed.
 */
export class ApprovalPayloadMismatchError extends AppError {
  constructor(expectedHash: string, observedHash: string) {
    super(
      409,
      'APPROVAL_PAYLOAD_MISMATCH',
      'Approval payload has changed since the request was created — re-create the approval rather than reusing the prior approvalId',
      { expectedHash, observedHash },
    );
    this.name = 'ApprovalPayloadMismatchError';
  }
}
