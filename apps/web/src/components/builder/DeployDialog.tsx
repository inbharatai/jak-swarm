'use client';

import React, { useState } from 'react';
import { projectApi } from '@/lib/api-client';
import { Button, Input, Spinner, Badge, Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogCloseButton } from '@/components/ui';
import { Rocket, ExternalLink, CheckCircle, XCircle, Loader2, Plus, Trash2 } from 'lucide-react';

interface EnvVar {
  key: string;
  value: string;
}

interface DeployDialogProps {
  projectId: string;
  projectName: string;
  currentDeploymentUrl?: string | null;
  open: boolean;
  onClose: () => void;
  onDeployed: () => void;
}

export function DeployDialog({ projectId, projectName, currentDeploymentUrl, open, onClose, onDeployed }: DeployDialogProps) {
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<{ url?: string; error?: string } | null>(null);
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);

  const addEnvVar = () => setEnvVars(prev => [...prev, { key: '', value: '' }]);
  const removeEnvVar = (index: number) => setEnvVars(prev => prev.filter((_, i) => i !== index));
  const updateEnvVar = (index: number, field: 'key' | 'value', val: string) => {
    setEnvVars(prev => prev.map((ev, i) => i === index ? { ...ev, [field]: val } : ev));
  };

  const handleDeploy = async () => {
    setDeploying(true);
    setDeployResult(null);
    try {
      await projectApi.deploy(projectId);
      setDeployResult({ url: `Deployment started for ${projectName}` });
      onDeployed();
    } catch (e) {
      setDeployResult({ error: e instanceof Error ? e.message : 'Deployment failed' });
    } finally {
      setDeploying(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Deploy to Vercel</DialogTitle>
        <DialogCloseButton onClick={onClose} />
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4">
          {/* Current deployment */}
          {currentDeploymentUrl && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-emerald-400">Currently deployed</p>
                <a href={currentDeploymentUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-300 hover:underline truncate block">
                  {currentDeploymentUrl}
                </a>
              </div>
              <ExternalLink className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            </div>
          )}

          {/* Project info */}
          <div>
            <p className="text-sm font-medium mb-1">Project</p>
            <p className="text-xs text-muted-foreground">{projectName}</p>
          </div>

          {/* Environment Variables */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium">Environment Variables</p>
              <Button variant="ghost" size="sm" onClick={addEnvVar} className="gap-1 text-xs h-7">
                <Plus className="h-3 w-3" />
                Add
              </Button>
            </div>
            {envVars.length === 0 ? (
              <p className="text-xs text-muted-foreground">No environment variables configured.</p>
            ) : (
              <div className="space-y-2">
                {envVars.map((ev, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={ev.key}
                      onChange={(e) => updateEnvVar(i, 'key', e.target.value)}
                      placeholder="KEY"
                      className="text-xs font-mono flex-1"
                    />
                    <Input
                      value={ev.value}
                      onChange={(e) => updateEnvVar(i, 'value', e.target.value)}
                      placeholder="value"
                      className="text-xs font-mono flex-1"
                    />
                    <Button variant="ghost" size="sm" onClick={() => removeEnvVar(i)} className="h-8 w-8 p-0">
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Deploy result */}
          {deployResult && (
            <div className={`p-3 rounded-lg text-xs ${deployResult.error ? 'bg-destructive/10 border border-destructive/20 text-destructive' : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'}`}>
              {deployResult.error ? (
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 shrink-0" />
                  {deployResult.error}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  {deployResult.url}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleDeploy} disabled={deploying} className="gap-1.5">
          {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          {deploying ? 'Deploying...' : currentDeploymentUrl ? 'Redeploy' : 'Deploy'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
