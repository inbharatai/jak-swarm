'use client';

import React, { useState } from 'react';
import { Button, Input, Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogCloseButton, Spinner } from '@/components/ui';
import { GitBranch, Upload, Download, CheckCircle, XCircle, Loader2 } from 'lucide-react';

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
  const [action, setAction] = useState<'push' | 'pull'>('push');

  const handleSync = async () => {
    if (!repoUrl.trim()) return;
    setSyncing(true);
    setSyncResult(null);

    try {
      // Call the project API to sync with GitHub
      const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
      const { createClient } = await import('@/lib/supabase');
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;

      const response = await fetch(`${BASE_URL}/projects/${projectId}/deploy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: action === 'push' ? 'SYNC_GITHUB' : 'SYNC_GITHUB',
          githubRepo: repoUrl,
        }),
      });

      if (response.ok) {
        setSyncResult({ success: true, message: `${action === 'push' ? 'Pushed to' : 'Pulled from'} GitHub successfully` });
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

          {/* Action toggle */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Action</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setAction('push')}
                className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm transition-colors ${
                  action === 'push' ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/30'
                }`}
              >
                <Upload className="h-4 w-4" />
                Push to GitHub
              </button>
              <button
                onClick={() => setAction('pull')}
                className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm transition-colors ${
                  action === 'pull' ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/30'
                }`}
              >
                <Download className="h-4 w-4" />
                Pull from GitHub
              </button>
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
          {syncing ? 'Syncing...' : action === 'push' ? 'Push' : 'Pull'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
