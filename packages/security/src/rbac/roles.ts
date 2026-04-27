import { UserRole, RiskLevel } from '@jak-swarm/shared';

/**
 * Permission strings used across the platform.
 * Format: <resource>:<action>
 */
export const Permissions = {
  // Workflow permissions
  WORKFLOW_CREATE: 'workflow:create',
  WORKFLOW_VIEW_OWN: 'workflow:view:own',
  WORKFLOW_VIEW_ALL: 'workflow:view:all',
  WORKFLOW_CANCEL: 'workflow:cancel',

  // Approval permissions
  APPROVAL_VIEW: 'approval:view',
  APPROVAL_GRANT_LOW: 'approval:grant:low',
  APPROVAL_GRANT_MEDIUM: 'approval:grant:medium',
  APPROVAL_GRANT_HIGH: 'approval:grant:high',
  APPROVAL_GRANT_CRITICAL: 'approval:grant:critical',

  // Skill permissions
  SKILL_VIEW: 'skill:view',
  SKILL_PROPOSE: 'skill:propose',
  SKILL_APPROVE: 'skill:approve',
  SKILL_MANAGE: 'skill:manage',

  // Tool permissions
  TOOL_EXECUTE_READ: 'tool:execute:read',
  TOOL_EXECUTE_WRITE: 'tool:execute:write',
  TOOL_EXECUTE_DESTRUCTIVE: 'tool:execute:destructive',

  // Admin permissions
  ADMIN_CONSOLE: 'admin:console',
  ADMIN_TENANT_SETTINGS: 'admin:tenant:settings',
  ADMIN_USER_MANAGEMENT: 'admin:user:management',
  ADMIN_AUDIT_LOG: 'admin:audit:log',
  ADMIN_INDUSTRY_CONFIG: 'admin:industry:config',

  // Memory permissions
  MEMORY_READ: 'memory:read',
  MEMORY_WRITE: 'memory:write',
  MEMORY_DELETE: 'memory:delete',
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

/**
 * Permission matrix — maps UserRole to the set of permissions they hold.
 */
export const ROLE_PERMISSIONS: Record<UserRole, Set<Permission>> = {
  [UserRole.TENANT_ADMIN]: new Set<Permission>([
    // All permissions
    ...Object.values(Permissions) as Permission[],
  ]),

  [UserRole.OPERATOR]: new Set<Permission>([
    Permissions.WORKFLOW_CREATE,
    Permissions.WORKFLOW_VIEW_ALL,
    Permissions.WORKFLOW_CANCEL,
    Permissions.APPROVAL_VIEW,
    Permissions.APPROVAL_GRANT_LOW,
    Permissions.APPROVAL_GRANT_MEDIUM,
    Permissions.APPROVAL_GRANT_HIGH,
    Permissions.SKILL_VIEW,
    Permissions.SKILL_PROPOSE,
    Permissions.TOOL_EXECUTE_READ,
    Permissions.TOOL_EXECUTE_WRITE,
    Permissions.MEMORY_READ,
    Permissions.MEMORY_WRITE,
    Permissions.ADMIN_AUDIT_LOG,
  ]),

  [UserRole.REVIEWER]: new Set<Permission>([
    Permissions.WORKFLOW_VIEW_ALL,
    Permissions.APPROVAL_VIEW,
    Permissions.APPROVAL_GRANT_LOW,
    Permissions.APPROVAL_GRANT_MEDIUM,
    Permissions.SKILL_VIEW,
    Permissions.TOOL_EXECUTE_READ,
    Permissions.MEMORY_READ,
  ]),

  [UserRole.END_USER]: new Set<Permission>([
    Permissions.WORKFLOW_CREATE,
    Permissions.WORKFLOW_VIEW_OWN,
    Permissions.APPROVAL_VIEW,
    Permissions.TOOL_EXECUTE_READ,
    Permissions.MEMORY_READ,
  ]),

  // Sprint 2.6 — third-party auditors invited per-engagement.
  // Permissions are intentionally MINIMAL at the global RBAC layer; the
  // engagement-isolation middleware in apps/api/src/routes/external-
  // auditor.routes.ts is the source of truth for what an auditor can
  // see (per-audit-run scoped). At the global RBAC level, an
  // EXTERNAL_AUDITOR holds no broad permissions — they cannot create
  // workflows, view other tenant data, or touch admin surfaces.
  [UserRole.EXTERNAL_AUDITOR]: new Set<Permission>([]),
};

/**
 * Risk level approval permissions — maps risk level to the minimum role required to approve.
 */
export const RISK_APPROVAL_ROLE: Record<RiskLevel, UserRole> = {
  [RiskLevel.LOW]: UserRole.REVIEWER,
  [RiskLevel.MEDIUM]: UserRole.REVIEWER,
  [RiskLevel.HIGH]: UserRole.OPERATOR,
  [RiskLevel.CRITICAL]: UserRole.TENANT_ADMIN,
};
