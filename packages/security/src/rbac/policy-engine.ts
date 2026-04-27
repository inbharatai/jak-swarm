import { UserRole, RiskLevel } from '@jak-swarm/shared';
import { ROLE_PERMISSIONS, RISK_APPROVAL_ROLE, Permissions } from './roles.js';
import type { Permission } from './roles.js';

// Role hierarchy for comparison
const ROLE_HIERARCHY: Record<UserRole, number> = {
  // EXTERNAL_AUDITOR is intentionally below END_USER. The portal does
  // its own engagement-scoped checks; this hierarchy is for general
  // RBAC and an auditor must never satisfy a "ceiling" check meant
  // for normal tenant users.
  [UserRole.EXTERNAL_AUDITOR]: 0,
  [UserRole.END_USER]: 1,
  [UserRole.REVIEWER]: 2,
  [UserRole.OPERATOR]: 3,
  [UserRole.TENANT_ADMIN]: 4,
};

export class PolicyEngine {
  /**
   * Check if a role has a specific permission.
   */
  checkPermission(role: UserRole, permission: Permission): boolean {
    const permissions = ROLE_PERMISSIONS[role];
    return permissions.has(permission);
  }

  /**
   * Check if a role has permission for a string action on a resource.
   * Supports wildcard-style action strings like 'workflow:view'.
   */
  checkAction(role: UserRole, action: string, resource: string): boolean {
    const permissionKey = `${resource}:${action}` as Permission;
    if (ROLE_PERMISSIONS[role].has(permissionKey)) {
      return true;
    }

    // Check broader permissions (e.g., workflow:view:all covers workflow:view:own)
    for (const perm of ROLE_PERMISSIONS[role]) {
      if (perm.startsWith(`${resource}:${action}`)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a role can approve a specific risk level.
   */
  canApproveRiskLevel(role: UserRole, riskLevel: RiskLevel): boolean {
    const requiredRole = RISK_APPROVAL_ROLE[riskLevel];
    return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[requiredRole];
  }

  /**
   * Check if a role can start workflows.
   */
  canStartWorkflow(role: UserRole): boolean {
    return this.checkPermission(role, Permissions.WORKFLOW_CREATE);
  }

  /**
   * Check if a role can manage (approve/reject) skills.
   */
  canManageSkills(role: UserRole): boolean {
    return this.checkPermission(role, Permissions.SKILL_MANAGE);
  }

  /**
   * Check if a role can access the admin console.
   */
  canAccessAdminConsole(role: UserRole): boolean {
    return this.checkPermission(role, Permissions.ADMIN_CONSOLE);
  }

  /**
   * Check if a role can execute a tool given its risk class.
   */
  canExecuteTool(role: UserRole, toolRiskClass: 'READ_ONLY' | 'WRITE' | 'DESTRUCTIVE' | 'EXTERNAL_SIDE_EFFECT'): boolean {
    switch (toolRiskClass) {
      case 'READ_ONLY':
        return this.checkPermission(role, Permissions.TOOL_EXECUTE_READ);
      case 'WRITE':
        return this.checkPermission(role, Permissions.TOOL_EXECUTE_WRITE);
      case 'DESTRUCTIVE':
      case 'EXTERNAL_SIDE_EFFECT':
        return this.checkPermission(role, Permissions.TOOL_EXECUTE_DESTRUCTIVE);
    }
  }

  /**
   * Check if a role can view workflows belonging to a specific user.
   * Admins and operators see all; end users see only their own.
   */
  canViewWorkflow(role: UserRole, requestingUserId: string, workflowUserId: string): boolean {
    if (this.checkPermission(role, Permissions.WORKFLOW_VIEW_ALL)) return true;
    if (
      this.checkPermission(role, Permissions.WORKFLOW_VIEW_OWN) &&
      requestingUserId === workflowUserId
    ) {
      return true;
    }
    return false;
  }

  /**
   * Get all permissions for a role as an array.
   */
  getPermissions(role: UserRole): Permission[] {
    return [...ROLE_PERMISSIONS[role]];
  }

  /**
   * Compare two roles — returns true if roleA is at least as privileged as roleB.
   */
  roleAtLeast(roleA: UserRole, roleB: UserRole): boolean {
    return ROLE_HIERARCHY[roleA] >= ROLE_HIERARCHY[roleB];
  }
}

// Singleton instance
export const policyEngine = new PolicyEngine();
