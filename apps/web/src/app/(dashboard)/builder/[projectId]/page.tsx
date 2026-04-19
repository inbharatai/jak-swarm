'use client';

import React, { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';

// Lazy-load Monaco to avoid SSR issues and reduce initial bundle
const MonacoEditor = lazy(() => import('@monaco-editor/react').then(mod => ({ default: mod.default })));
import { useProject, type ProjectFile } from '@/hooks/useProject';
import { useProjectStream } from '@/hooks/useProjectStream';
import { projectApi, type Checkpoint } from '@/lib/api-client';
import { Button, Badge, Spinner, Card, CardContent, Input } from '@/components/ui';
import { BuildProgress, eventsToBuildSteps } from '@/components/builder/BuildProgress';
import { ImageUpload } from '@/components/builder/ImageUpload';
import { DeployDialog } from '@/components/builder/DeployDialog';
import { GitHubSync } from '@/components/builder/GitHubSync';
import { CheckpointTimeline, CheckpointTimelineHeader } from '@/components/builder/CheckpointTimeline';
import {
  ArrowLeft, Play, Rocket, GitBranch, Settings, Eye, Code2,
  ChevronRight, ChevronDown, FileText, FolderOpen, Folder, Send,
  ExternalLink, Loader2, Image as ImageIcon,
} from 'lucide-react';

// ─── File Tree Helpers ──────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: TreeNode[];
  language?: string | null;
}

function buildFileTree(files: ProjectFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirs = new Map<string, TreeNode>();

  for (const file of files) {
    const parts = file.path.split('/');
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (i === parts.length - 1) {
        // File
        const fileNode: TreeNode = { name: part, path: file.path, type: 'file', language: file.language };
        const parent = parentPath ? dirs.get(parentPath) : null;
        if (parent) {
          parent.children = parent.children ?? [];
          parent.children.push(fileNode);
        } else {
          root.push(fileNode);
        }
      } else {
        // Directory
        if (!dirs.has(currentPath)) {
          const dirNode: TreeNode = { name: part, path: currentPath, type: 'folder', children: [] };
          dirs.set(currentPath, dirNode);
          const parent = parentPath ? dirs.get(parentPath) : null;
          if (parent) {
            parent.children = parent.children ?? [];
            parent.children.push(dirNode);
          } else {
            root.push(dirNode);
          }
        }
      }
    }
  }

  return root;
}

// ─── File Tree Node Component ───────────────────────────────────────────

function FileTreeNode({
  node, depth = 0, selectedPath, onSelect,
}: {
  node: TreeNode; depth?: number; selectedPath: string | null; onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isSelected = node.path === selectedPath;

  if (node.type === 'folder') {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 w-full px-2 py-1 text-xs hover:bg-accent rounded transition-colors"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          {expanded ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && node.children?.map(child => (
          <FileTreeNode key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`flex items-center gap-1 w-full px-2 py-1 text-xs rounded transition-colors ${isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-accent'}`}
      style={{ paddingLeft: `${depth * 12 + 16}px` }}
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

// ─── Status Badge ───────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'success' | 'destructive' | 'warning' | 'secondary'; icon?: React.ReactNode }> = {
  DRAFT: { label: 'Draft', variant: 'secondary' },
  GENERATING: { label: 'Generating...', variant: 'warning', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  BUILDING: { label: 'Building...', variant: 'warning', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  READY: { label: 'Ready', variant: 'success' },
  DEPLOYED: { label: 'Deployed', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'destructive' },
};

// ─── Main Builder IDE ───────────────────────────────────────────────────

export default function BuilderIDEPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const { project, isLoading, isGenerating, refresh } = useProject(projectId);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'code' | 'preview'>('code');
  const [chatMessage, setChatMessage] = useState('');
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [showDeployDialog, setShowDeployDialog] = useState(false);
  const [showGitHubSync, setShowGitHubSync] = useState(false);
  // FIX #9: Error state for user-visible error messages
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSavingFile, setIsSavingFile] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const selectedFileRef = useRef<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const { events: streamEvents } = useProjectStream(isGenerating ? projectId : undefined);
  const buildSteps = eventsToBuildSteps(streamEvents);

  // ─── Checkpoint timeline state ────────────────────────────────────
  // Pulled separately from `project.versions` so it carries the diff
  // metadata the timeline renders. Refetched after runs complete, after
  // restore, and when the user presses "Snapshot now".
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [showCheckpoints, setShowCheckpoints] = useState(false);

  const reloadCheckpoints = useCallback(async () => {
    try {
      const list = await projectApi.listCheckpoints(projectId, 30);
      setCheckpoints(list ?? []);
    } catch {
      // Non-fatal — timeline stays empty until the next reload.
    }
  }, [projectId]);

  useEffect(() => {
    void reloadCheckpoints();
  }, [reloadCheckpoints, project?.currentVersion, isGenerating]);

  // Cleanup save timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [project?.conversations]);

  // Auto-select first file
  useEffect(() => {
    if (!selectedFile && project?.files?.length) {
      const mainFile = project.files.find(f => f.path === 'src/app/page.tsx') ?? project.files[0];
      if (mainFile) setSelectedFile(mainFile.path);
    }
  }, [project?.files, selectedFile]);

  // Keep selectedFileRef in sync to avoid stale closures in debounced save
  useEffect(() => {
    selectedFileRef.current = selectedFile;
  }, [selectedFile]);

  if (isLoading || !project) {
    return (
      <div className="flex items-center justify-center min-h-[500px]">
        <Spinner size="lg" />
      </div>
    );
  }

  const fileTree = buildFileTree(project.files ?? []);
  const currentFile = project.files?.find(f => f.path === selectedFile);
  const statusConfig = STATUS_CONFIG[project.status] ?? STATUS_CONFIG.DRAFT;

  const handleGenerate = async () => {
    if (!chatMessage.trim()) return;
    setIsSending(true);
    try {
      if (project.status === 'DRAFT' && (!project.files || project.files.length === 0)) {
        await projectApi.generate(projectId, {
          description: chatMessage,
          imageBase64: imageBase64 ?? undefined,
        });
      } else {
        await projectApi.iterate(projectId, {
          message: chatMessage,
          imageBase64: imageBase64 ?? undefined,
        });
      }
      setImageBase64(null);
      setChatMessage('');
      refresh();
    } catch (e) {
      // FIX #9: Show error to user, not just console
      const msg = e instanceof Error ? e.message : 'Failed to send message. Please try again.';
      setErrorMessage(msg);
      setTimeout(() => setErrorMessage(null), 8000);
    } finally {
      setIsSending(false);
    }
  };

  const handleDeploy = async () => {
    setIsDeploying(true);
    try {
      await projectApi.deploy(projectId);
      refresh();
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'Deploy failed');
    } finally {
      setIsDeploying(false);
    }
  };

  // Auto-save on editor change (debounced 1.5s)
  const handleEditorChange = (value: string | undefined) => {
    if (!value || !selectedFile || !currentFile || value === currentFile.content) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      const fileToSave = selectedFileRef.current;
      if (!fileToSave) return;
      setIsSavingFile(true);
      try {
        await projectApi.updateFile(projectId, fileToSave, value);
        refresh();
      } catch (e) {
        setErrorMessage('Failed to save file');
        setTimeout(() => setErrorMessage(null), 5000);
      } finally {
        setIsSavingFile(false);
      }
    }, 1500);
  };


  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      {/* ── Top Bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b px-4 py-2 shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/builder')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="font-display font-semibold text-sm">{project.name}</h1>
            <p className="text-xs text-muted-foreground">{project.framework} &middot; v{project.currentVersion}</p>
          </div>
          <Badge variant={statusConfig.variant} className="gap-1">
            {statusConfig.icon}
            {statusConfig.label}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {project.deploymentUrl && (
            <a href={project.deploymentUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" />
                Live
              </Button>
            </a>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowGitHubSync(true)} className="gap-1.5">
            <GitBranch className="h-3.5 w-3.5" />
            GitHub
          </Button>
          <Button variant="outline" size="sm" disabled={isGenerating} onClick={() => setShowDeployDialog(true)} className="gap-1.5">
            <Rocket className="h-3.5 w-3.5" />
            Deploy
          </Button>
        </div>
      </div>

      {/* FIX #9: Error banner */}
      {errorMessage && (
        <div className="mx-4 mt-2 px-4 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center justify-between">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="text-destructive hover:text-destructive/80 ml-2 font-bold">&times;</button>
        </div>
      )}

      {/* ── Main 3-Panel Layout ─────────────────────────────────────── */}
      {/* FIX #21: Responsive — stack vertically on mobile, 3-panel on lg+ */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0">
        {/* Left: File Explorer — hidden on mobile, collapsible sidebar on tablet */}
        <div className="hidden md:block w-56 border-r overflow-y-auto shrink-0 py-2">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Files</p>
          {fileTree.length === 0 ? (
            <p className="px-3 text-xs text-muted-foreground">No files yet. Describe your app to get started.</p>
          ) : (
            fileTree.map(node => (
              <FileTreeNode key={node.path} node={node} selectedPath={selectedFile} onSelect={setSelectedFile} />
            ))
          )}

          {/* Checkpoint timeline — diff-aware replacement for the old Versions list */}
          <div className="mt-4 border-t pt-3 px-3">
            <button
              onClick={() => setShowCheckpoints((s) => !s)}
              className="w-full flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors pb-2"
              aria-expanded={showCheckpoints}
            >
              <span className="flex items-center gap-1">
                {showCheckpoints ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Checkpoints {checkpoints.length > 0 ? `(${checkpoints.length})` : ''}
              </span>
            </button>
            {showCheckpoints ? (
              <div className="space-y-2">
                <CheckpointTimelineHeader
                  projectId={projectId}
                  onSnapshot={() => reloadCheckpoints()}
                  disabled={isGenerating}
                />
                <CheckpointTimeline
                  projectId={projectId}
                  checkpoints={checkpoints}
                  onRestored={() => {
                    refresh();
                    void reloadCheckpoints();
                  }}
                  onReload={reloadCheckpoints}
                />
              </div>
            ) : null}
          </div>
        </div>

        {/* Center: Code / Preview */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* FIX #22: Tab Bar with ARIA roles */}
          <div className="flex items-center gap-1 border-b px-2 py-1 shrink-0" role="tablist" aria-label="Editor view">
            <button
              role="tab"
              aria-selected={activeTab === 'code'}
              aria-controls="editor-panel"
              onClick={() => setActiveTab('code')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'code' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Code2 className="h-3.5 w-3.5" />
              Code
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'preview'}
              aria-controls="preview-panel"
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'preview' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Eye className="h-3.5 w-3.5" />
              Preview
            </button>
            {selectedFile && (
              <span className="ml-2 text-xs text-muted-foreground truncate">{selectedFile}</span>
            )}
            {isSavingFile && (
              <span className="ml-2 text-[10px] text-amber-400 animate-pulse">Saving...</span>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto min-h-0">
            {activeTab === 'code' ? (
              currentFile ? (
                <Suspense fallback={<div className="flex items-center justify-center h-full"><Spinner /></div>}>
                  <MonacoEditor
                    height="100%"
                    language={({'typescript':'typescript','javascript':'javascript','css':'css','json':'json','markdown':'markdown','prisma':'graphql','html':'html','tsx':'typescriptreact','jsx':'javascriptreact','yaml':'yaml','sql':'sql','shell':'shell'} as Record<string,string>)[currentFile.language ?? ''] ?? 'plaintext'}
                    value={currentFile.content}
                    theme="vs-dark"
                    onChange={handleEditorChange}
                    options={{
                      readOnly: false,
                      minimap: { enabled: false },
                      fontSize: 13,
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      wordWrap: 'on',
                      padding: { top: 12 },
                      renderLineHighlight: 'none',
                      folding: true,
                      automaticLayout: true,
                    }}
                  />
                </Suspense>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  Select a file to view its code
                </div>
              )
            ) : (
              project.previewUrl ? (
                <iframe
                  src={project.previewUrl}
                  className="w-full h-full border-0"
                  title="App Preview"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  {isGenerating ? (
                    <div className="text-center">
                      <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
                      <p>Generating your app...</p>
                    </div>
                  ) : (
                    'No preview available. Generate or build your app first.'
                  )}
                </div>
              )
            )}
          </div>
        </div>

        {/* Right: Chat — full width on mobile, fixed width on desktop */}
        <div className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l flex flex-col shrink-0">
          <div className="px-3 py-2 border-b">
            <p className="text-xs font-semibold">Chat</p>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
            {(!project.conversations || project.conversations.length === 0) && (
              <div className="text-center text-xs text-muted-foreground mt-8">
                <Code2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p>Describe what you want to build.</p>
                <p className="mt-1 text-[10px]">e.g. &ldquo;Build a task manager with user auth, drag-and-drop boards, and dark mode&rdquo;</p>
              </div>
            )}
            {project.conversations?.map(msg => (
              <div key={msg.id} className={`text-xs ${msg.role === 'user' ? 'text-right' : ''}`}>
                <div className={`inline-block max-w-[90%] rounded-lg px-3 py-2 ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'
                }`}>
                  {msg.content}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {msg.role === 'user' ? 'You' : 'JAK Builder'} &middot; {new Date(msg.createdAt).toLocaleTimeString()}
                </p>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Build Progress */}
          {isGenerating && streamEvents.length > 0 && (
            <div className="border-t px-3 py-2">
              <BuildProgress steps={buildSteps} />
            </div>
          )}

          {/* Input */}
          <div className="border-t p-3 space-y-2">
            {imageBase64 && (
              <ImageUpload
                onImageSelected={setImageBase64}
                onClear={() => setImageBase64(null)}
              />
            )}
            <div className="flex gap-2">
              {!imageBase64 && (
                <ImageUpload
                  onImageSelected={setImageBase64}
                  onClear={() => setImageBase64(null)}
                  className="shrink-0"
                />
              )}
              <Input
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                placeholder={project.files?.length ? 'Describe changes...' : 'Describe your app...'}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(); } }}
                disabled={isSending || isGenerating}
                className="text-xs"
              />
              <Button size="sm" onClick={handleGenerate} disabled={isSending || isGenerating || !chatMessage.trim()}>
                {isSending || isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <DeployDialog
        projectId={projectId}
        projectName={project.name}
        currentDeploymentUrl={project.deploymentUrl}
        open={showDeployDialog}
        onClose={() => setShowDeployDialog(false)}
        onDeployed={() => { setShowDeployDialog(false); refresh(); }}
      />
      <GitHubSync
        projectId={projectId}
        currentRepo={project.githubRepo}
        open={showGitHubSync}
        onClose={() => setShowGitHubSync(false)}
        onSynced={() => { setShowGitHubSync(false); refresh(); }}
      />
    </div>
  );
}
