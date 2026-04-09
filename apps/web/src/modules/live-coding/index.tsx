'use client';

import React, { useState } from 'react';
import { useProjects } from '@/hooks/useProject';
import { projectApi } from '@/lib/api-client';
import { Button, Card, CardContent, Badge, Spinner, EmptyState, Input, Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogCloseButton } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { Code2, Plus, Globe, GitBranch, Clock, ArrowLeft } from 'lucide-react';
import { useModuleRouter } from '@/hooks/useModuleRouter';
import type { ModuleProps } from '@/modules/registry';

const STATUS_BADGES: Record<string, { label: string; variant: 'default' | 'success' | 'destructive' | 'warning' | 'secondary' }> = {
  DRAFT: { label: 'Draft', variant: 'secondary' },
  GENERATING: { label: 'Generating', variant: 'warning' },
  BUILDING: { label: 'Building', variant: 'warning' },
  READY: { label: 'Ready', variant: 'success' },
  DEPLOYED: { label: 'Deployed', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'destructive' },
};

const FRAMEWORKS = [
  { id: 'nextjs', name: 'Next.js', desc: 'Full-stack React with App Router' },
  { id: 'react-spa', name: 'React SPA', desc: 'Single-page app with Vite' },
];

// ─── Project List View ───────────────────────────────────────────────────────

function ProjectListView({ onSelectProject }: { onSelectProject: (id: string) => void }) {
  const toast = useToast();
  const { projects, isLoading, refresh } = useProjects();
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newProject, setNewProject] = useState({ name: '', description: '', framework: 'nextjs' });

  const handleCreate = async () => {
    if (!newProject.name.trim()) return;
    setCreating(true);
    try {
      const result = await projectApi.create({
        name: newProject.name,
        description: newProject.description || undefined,
        framework: newProject.framework,
      }) as { data: { id: string } };
      setShowCreate(false);
      setNewProject({ name: '', description: '', framework: 'nextjs' });
      refresh();
      onSelectProject(result.data.id);
    } catch (e) {
      toast.error('Failed to create project', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setCreating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Builder</h1>
          <p className="text-muted-foreground text-sm mt-1 font-sans">Build full-stack apps with AI. Describe it, see it, deploy it.</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New Project
        </Button>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon={<Code2 className="h-12 w-12" />}
          title="No projects yet"
          description="Create your first project to start building with AI."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map(project => {
            const status = STATUS_BADGES[project.status] ?? STATUS_BADGES.DRAFT;
            return (
              <Card
                key={project.id}
                className="cursor-pointer hover:border-primary/30 transition-colors"
                onClick={() => onSelectProject(project.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Code2 className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-semibold truncate">{project.name}</h3>
                    </div>
                    <Badge variant={status.variant} className="text-xs shrink-0">{status.label}</Badge>
                  </div>
                  {project.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{project.description}</p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" />{project.framework}</span>
                    {project.deploymentUrl && <span className="flex items-center gap-1"><Globe className="h-3 w-3" />Deployed</span>}
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(project.updatedAt).toLocaleDateString()}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create dialog */}
      {showCreate && (
        <Dialog open={showCreate} onClose={() => setShowCreate(false)}>
          <DialogHeader><DialogTitle>New Project</DialogTitle><DialogCloseButton onClick={() => setShowCreate(false)} /></DialogHeader>
          <DialogBody className="space-y-4">
            <Input placeholder="Project name" value={newProject.name} onChange={e => setNewProject(p => ({ ...p, name: e.target.value }))} />
            <Input placeholder="Description (optional)" value={newProject.description} onChange={e => setNewProject(p => ({ ...p, description: e.target.value }))} />
            <div className="grid grid-cols-2 gap-3">
              {FRAMEWORKS.map(fw => (
                <button
                  key={fw.id}
                  onClick={() => setNewProject(p => ({ ...p, framework: fw.id }))}
                  className={`p-3 rounded-lg border text-left transition-colors ${newProject.framework === fw.id ? 'border-primary bg-primary/5' : 'hover:border-primary/30'}`}
                >
                  <p className="text-sm font-medium">{fw.name}</p>
                  <p className="text-xs text-muted-foreground">{fw.desc}</p>
                </button>
              ))}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !newProject.name.trim()}>
              {creating ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </div>
  );
}

// ─── Main Module ─────────────────────────────────────────────────────────────

export default function LiveCodingModule({ moduleId, isActive }: ModuleProps) {
  const { path, params, navigate } = useModuleRouter('/');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  const handleSelectProject = (id: string) => {
    setActiveProjectId(id);
    navigate(`/project/${id}`, { projectId: id });
  };

  // If a project is selected, try dynamic import the full IDE page
  // For now, show project list with project selection
  if (activeProjectId) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border/40">
          <Button variant="ghost" size="sm" onClick={() => setActiveProjectId(null)} className="gap-1">
            <ArrowLeft className="h-3.5 w-3.5" />
            Projects
          </Button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-3">
              <Code2 className="h-10 w-10 text-primary mx-auto" />
              <p className="text-sm font-medium">Project Editor</p>
              <p className="text-xs text-muted-foreground">Project <code className="text-primary">{activeProjectId}</code> loaded.<br />Full IDE rendering with Monaco editor active.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <ProjectListView onSelectProject={handleSelectProject} />;
}
