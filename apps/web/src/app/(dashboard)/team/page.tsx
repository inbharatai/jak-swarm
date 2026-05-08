'use client';

/**
 * /team — org chart + member directory.
 *
 * Two-pane layout:
 *   Left:  departments (tree if parents exist), member counts, "+ Department"
 *   Right: searchable member directory + per-member "Assign to dept" + "Set manager"
 *
 * The CEO uses this page when they want to see who's on the team and assign
 * tasks. The "Assign task to..." action is available from any workflow detail
 * page; this page is the source of truth for who is assignable.
 *
 * RBAC:
 *   - Read: any authed tenant member
 *   - Write (create/update/delete dept, change membership): TENANT_ADMIN+
 */

import React, { useState, useMemo } from 'react';
import useSWR from 'swr';
import { Users, Plus, Search, Loader2, Building2 } from 'lucide-react';
import { Card, CardContent, Button, Input, Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { dataFetcher, teamApi } from '@/lib/api-client';

interface Department {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  _count?: { members: number; children: number };
}

interface Member {
  id: string;
  name: string | null;
  email: string;
  jobTitle: string | null;
  role: string;
  departmentId: string | null;
  managerId: string | null;
  department: { id: string; name: string } | null;
  manager: { id: string; name: string | null; email: string } | null;
}

export default function TeamPage() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [activeDeptId, setActiveDeptId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptDesc, setNewDeptDesc] = useState('');

  const { data: deptResp, mutate: refetchDepts } = useSWR<{
    ok: true;
    data: { items: Department[]; count: number };
  }>('/team/departments', dataFetcher);
  const departments = deptResp?.data.items ?? [];

  const memberQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (activeDeptId) params.set('departmentId', activeDeptId);
    const qs = params.toString();
    return `/team/members${qs ? `?${qs}` : ''}`;
  }, [search, activeDeptId]);

  const { data: membersResp, mutate: refetchMembers, isLoading } = useSWR<{
    ok: true;
    data: { items: Member[]; count: number };
  }>(memberQuery, dataFetcher);
  const members = membersResp?.data.items ?? [];

  async function handleCreateDept() {
    if (!newDeptName.trim()) return;
    try {
      await teamApi.createDepartment({
        name: newDeptName.trim(),
        description: newDeptDesc.trim() || undefined,
      });
      toast.success('Department created');
      setNewDeptName('');
      setNewDeptDesc('');
      setCreateOpen(false);
      refetchDepts();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create');
    }
  }

  async function handleAssignMemberToDept(userId: string, departmentId: string | null) {
    try {
      await teamApi.updateMember(userId, { departmentId });
      refetchMembers();
      refetchDepts();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update');
    }
  }

  return (
    <div className="container mx-auto py-6 max-w-6xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Users className="h-6 w-6" /> Team
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Departments + members. Use this to assign workflow tasks to humans.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Departments rail */}
        <div className="md:col-span-1 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Departments
            </h2>
            <Button size="sm" variant="ghost" className="gap-1" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3 w-3" /> Add
            </Button>
            <Dialog open={createOpen} onClose={() => setCreateOpen(false)}>
              <DialogHeader>
                <DialogTitle>New department</DialogTitle>
              </DialogHeader>
              <DialogBody>
                <div className="space-y-3">
                  <Input
                    placeholder="Name (e.g. Engineering, HR)"
                    value={newDeptName}
                    onChange={(e) => setNewDeptName(e.target.value)}
                  />
                  <Input
                    placeholder="Description (optional)"
                    value={newDeptDesc}
                    onChange={(e) => setNewDeptDesc(e.target.value)}
                  />
                </div>
              </DialogBody>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateDept}>Create</Button>
              </DialogFooter>
            </Dialog>
          </div>

          <button
            type="button"
            onClick={() => setActiveDeptId(null)}
            className={`w-full text-left p-2 rounded text-sm flex items-center justify-between ${
              activeDeptId === null ? 'bg-primary/10 border-primary/20 border' : 'hover:bg-muted'
            }`}
          >
            <span>All members</span>
            <span className="text-xs text-muted-foreground">{members.length}</span>
          </button>

          {departments.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setActiveDeptId(d.id)}
              className={`w-full text-left p-2 rounded text-sm flex items-center justify-between ${
                activeDeptId === d.id ? 'bg-primary/10 border-primary/20 border' : 'hover:bg-muted'
              }`}
            >
              <span className="flex items-center gap-2">
                <Building2 className="h-3 w-3 text-muted-foreground" />
                {d.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {d._count?.members ?? 0}
              </span>
            </button>
          ))}

          {departments.length === 0 && (
            <Card>
              <CardContent className="py-6 text-xs text-muted-foreground text-center">
                No departments yet. Click <strong>Add</strong> to create one.
              </CardContent>
            </Card>
          )}
        </div>

        {/* Members panel */}
        <div className="md:col-span-2 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, or job title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : members.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No members match.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {members.map((m) => (
                <Card key={m.id}>
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{m.name ?? m.email}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {m.jobTitle ? `${m.jobTitle} · ` : ''}
                          {m.email}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {m.department?.name ?? <span className="italic">No department</span>}
                          {m.manager && ` · reports to ${m.manager.name ?? m.manager.email}`}
                        </div>
                      </div>
                      <div className="shrink-0">
                        <select
                          value={m.departmentId ?? ''}
                          onChange={(e) =>
                            handleAssignMemberToDept(m.id, e.target.value || null)
                          }
                          className="text-xs border rounded px-2 py-1"
                        >
                          <option value="">— No dept —</option>
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
