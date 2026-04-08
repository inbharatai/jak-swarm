'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useProjects } from '@/hooks/useProject';
import { projectApi } from '@/lib/api-client';
import { Button, Card, CardContent, Badge, Spinner, EmptyState, Input, Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogCloseButton } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { Code2, Plus, Globe, GitBranch, Clock, Trash2 } from 'lucide-react';

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

export default function BuilderPage() {
  const toast = useToast();
  const router = useRouter();
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
      router.push(`/builder/${result.data.id}`);
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
    <div className="space-y-6">
      {/* Header */}
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

      {/* Project Grid */}
      {projects.length === 0 ? (
        <EmptyState
          icon={<Code2 className="h-12 w-12" />}
          title="No projects yet"
          description="Create your first project to start building with AI."
          action={
            <Button onClick={() => setShowCreate(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Create Project
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const statusInfo = STATUS_BADGES[project.status] ?? STATUS_BADGES.DRAFT;
            return (
              <Link key={project.id} href={`/builder/${project.id}`}>
                <Card className="h-full hover:border-primary/30 transition-colors cursor-pointer card-hover">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Code2 className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-display font-semibold text-sm">{project.name}</h3>
                          <p className="text-xs text-muted-foreground">{project.framework}</p>
                        </div>
                      </div>
                      <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                    </div>

                    {project.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{project.description}</p>
                    )}

                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {project.deploymentUrl && (
                        <span className="flex items-center gap-1">
                          <Globe className="h-3 w-3" />
                          Live
                        </span>
                      )}
                      {project.githubRepo && (
                        <span className="flex items-center gap-1">
                          <GitBranch className="h-3 w-3" />
                          GitHub
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        v{project.currentVersion}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* Create Project Dialog */}
      <Dialog open={showCreate} onClose={() => setShowCreate(false)}>
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
          <DialogCloseButton onClick={() => setShowCreate(false)} />
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Project Name</label>
              <Input
                value={newProject.name}
                onChange={(e) => setNewProject(prev => ({ ...prev, name: e.target.value }))}
                placeholder="My Awesome App"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Description (optional)</label>
              <Input
                value={newProject.description}
                onChange={(e) => setNewProject(prev => ({ ...prev, description: e.target.value }))}
                placeholder="A task management app with team collaboration..."
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Framework</label>
              <div className="grid grid-cols-2 gap-2">
                {FRAMEWORKS.map(fw => (
                  <button
                    key={fw.id}
                    onClick={() => setNewProject(prev => ({ ...prev, framework: fw.id }))}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      newProject.framework === fw.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/30'
                    }`}
                  >
                    <p className="text-sm font-medium">{fw.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{fw.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={creating || !newProject.name.trim()}>
            {creating ? <Spinner size="sm" /> : 'Create Project'}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
