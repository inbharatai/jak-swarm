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
