'use client';

import React, { useState } from 'react';
import { Button, Input, Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogCloseButton } from '@/components/ui';
import { GitBranch, Upload, CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface GitHubSyncProps {
  projectId: string;
  currentRepo?: string | null;
  open: boolean;
  onClose: () => void;
  onSynced: () => void;
}

export function GitHubSync({ projectId, currentRepo, open, onClose, onSynced }: GitHubSyncProps) {
  const [repoUrl, setRepoUrl] = useState(currentRepo ?? '');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleSync = async () => {
    if (!repoUrl.trim()) return;
    setSyncing(true);
    setSyncResult(null);

    try {
      // Call the project API to sync with GitHub. Use centralized resolver
      // so the production-misconfig guard fires uniformly (P0-A fix).
      const { buildApiUrl } = await import('@/lib/api-client');
      const { getRawToken } = await import('@/lib/auth');
      const { createClient } = await import('@/lib/supabase');
      let token = getRawToken();
      if (!token) {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        token = data?.session?.access_token ?? null;
      }
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(buildApiUrl(`/projects/${projectId}/deploy`), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'SYNC_GITHUB',
          githubRepo: repoUrl,
        }),
      });

      if (response.ok) {
        setSyncResult({ success: true, message: 'GitHub push queued successfully' });
        onSynced();
      } else {
        const err = await response.json();
        setSyncResult({ success: false, message: err?.error?.message ?? 'Sync failed' });
      }
    } catch (e) {
      setSyncResult({ success: false, message: e instanceof Error ? e.message : 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>GitHub Sync</DialogTitle>
        <DialogCloseButton onClick={onClose} />
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4">
          {/* Repo URL */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Repository</label>
            <Input
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="owner/repo or https://github.com/owner/repo"
              className="text-xs font-mono"
            />
            <p className="text-[10px] text-muted-foreground mt-1">Enter the repository in owner/repo format</p>
          </div>

          {/* Action */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Action</label>
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <Upload className="h-4 w-4" />
                Push to GitHub
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Pull/import is not implemented yet, so JAK only exposes the backed push path.
              </p>
            </div>
          </div>

          {/* Result */}
          {syncResult && (
            <div className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
              syncResult.success
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                : 'bg-destructive/10 border border-destructive/20 text-destructive'
            }`}>
              {syncResult.success ? <CheckCircle className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
              {syncResult.message}
            </div>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSync} disabled={syncing || !repoUrl.trim()} className="gap-1.5">
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
          {syncing ? 'Syncing...' : 'Push'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
