export enum UserRole {
  TENANT_ADMIN = 'TENANT_ADMIN',
  OPERATOR = 'OPERATOR',
  REVIEWER = 'REVIEWER',
  END_USER = 'END_USER',
}

export enum JobFunction {
  CEO = 'CEO',
  CTO = 'CTO',
  CMO = 'CMO',
  ENGINEER = 'ENGINEER',
  HR = 'HR',
  FINANCE = 'FINANCE',
  SALES = 'SALES',
  OPERATIONS = 'OPERATIONS',
  OTHER = 'OTHER',
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  name?: string;
  role: UserRole;
  active: boolean;
  createdAt: Date;
  jobFunction?: JobFunction;
  avatarUrl?: string;
}

export interface AuthSession {
  userId: string;
  tenantId: string;
  role: UserRole;
  email: string;
}
