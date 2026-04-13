'use client';

import { WorkspaceDashboard } from '@/components/workspace/WorkspaceDashboard';
import type { ModuleProps } from '@/modules/registry';

export default function CommandCenterModule({ moduleId }: ModuleProps) {
  return <WorkspaceDashboard title="Command Center" moduleId={moduleId} />;
}
