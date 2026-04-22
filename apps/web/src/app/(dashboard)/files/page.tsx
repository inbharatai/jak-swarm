'use client';

/**
 * Files tab — Track 2.5 of the hardening plan.
 *
 * Drag-drop upload, file grid with metadata, preview-via-signed-URL, delete.
 * Every row is a TenantDocument backed by Supabase Storage. The find_document
 * tool (registered server-side) lets any agent reference uploads by name,
 * tag, or content — the tab here is the UX surface that gets files into
 * that pipeline.
 */

import React, { useCallback, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  CloudUpload,
  FileText,
  FileImage,
  FileSpreadsheet,
  FileType,
  Loader2,
  Trash2,
  Eye,
  CheckCircle2,
  AlertCircle,
  Clock,
  X,
} from 'lucide-react';
import { documentApi, type TenantDocument, type DocumentListResponse } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button, Card, Badge, EmptyState, Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';

const ACCEPT = '.pdf,.txt,.md,.csv,.docx,.xlsx,.png,.jpg,.jpeg,.webp';
const MAX_SIZE_MB = 25;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function iconFor(mime: string) {
  if (mime.startsWith('image/')) return FileImage;
  if (mime.includes('spreadsheet') || mime.includes('csv')) return FileSpreadsheet;
  if (mime.includes('pdf') || mime.includes('word')) return FileText;
  return FileType;
}

function statusBadge(status: TenantDocument['status']) {
  switch (status) {
    case 'INDEXED':
      return (
        <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
          <CheckCircle2 className="mr-1 h-3 w-3" /> Indexed
        </Badge>
      );
    case 'PENDING':
      return (
        <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20">
          <Clock className="mr-1 h-3 w-3" /> Indexing
        </Badge>
      );
    case 'FAILED':
      return (
        <Badge className="bg-red-500/10 text-red-500 border-red-500/20">
          <AlertCircle className="mr-1 h-3 w-3" /> Failed
        </Badge>
      );
    default:
      return (
        <Badge className="bg-slate-500/10 text-slate-500 border-slate-500/20">{status}</Badge>
      );
  }
}

export default function FilesPage() {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<TenantDocument | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data, mutate, isLoading } = useSWR<{ success: true; data: DocumentListResponse }>(
    '/documents?limit=50',
    () => documentApi.list({ limit: 50 }),
    {
      // Poll every 5s when there's at least one PENDING doc so the UI
      // reflects the PENDING → INDEXED transition without a manual refresh.
      refreshInterval: (d) =>
        d?.data?.items.some((x: TenantDocument) => x.status === 'PENDING') ? 5000 : 30000,
    },
  );

  const docs = data?.data?.items ?? [];

  // ─── Upload handlers ──────────────────────────────────────────────────────

  const doUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setUploading(true);

      // Track 2 MVP: single-file upload per request, matching the server-side
      // contract (@fastify/multipart files: 1). Batch UI loops client-side.
      //
      // Fix F-7 (QA finding): when uploading 2+ files, the old code ran a
      // single mutate() AFTER the loop. Any error on file #N still hid the
      // success of files < N from the UI until the final mutate resolved,
      // and if SWR was mid-fetch during the loop the list could render the
      // partial state. We now `mutate()` after EACH successful upload so the
      // list updates row-by-row, and also wrap each upload in an
      // independent try/catch so one failure doesn't abort the rest.
      for (const file of Array.from(files)) {
        if (file.size > MAX_SIZE_MB * 1024 * 1024) {
          toast.error(
            `${file.name} is too large`,
            `Maximum upload size is ${MAX_SIZE_MB} MB.`,
          );
          continue;
        }
        try {
          await documentApi.upload(file);
          toast.success('Uploaded', `${file.name} — indexing in background`);
          // Incremental refresh — makes each successful upload visible in the
          // list before the next one starts. Await so batch uploads stay in
          // order and the final state is deterministic.
          await mutate();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Upload failed';
          toast.error(`Failed to upload ${file.name}`, msg);
        }
      }

      setUploading(false);
      // Final safety mutate in case the per-file ones were rate-limited.
      await mutate();
    },
    [toast, mutate],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      void doUpload(e.dataTransfer.files);
    },
    [doUpload],
  );

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void doUpload(e.target.files);
      if (inputRef.current) inputRef.current.value = '';
    },
    [doUpload],
  );

  // ─── Delete handler ──────────────────────────────────────────────────────

  const onDelete = useCallback(
    async (id: string, fileName: string) => {
      if (!confirm(`Delete "${fileName}"? This removes the file and all indexed chunks. Undo not available.`)) {
        return;
      }
      setDeletingId(id);
      try {
        await documentApi.delete(id);
        toast.success('Deleted', fileName);
        await mutate();
      } catch (err) {
        toast.error('Delete failed', err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setDeletingId(null);
      }
    },
    [toast, mutate],
  );

  // ─── Preview handler — fetches a fresh signed URL ────────────────────────

  const onPreview = useCallback(
    async (doc: TenantDocument) => {
      try {
        const response = await documentApi.get(doc.id);
        setPreviewDoc(response.data);
      } catch (err) {
        toast.error('Preview unavailable', err instanceof Error ? err.message : 'Unknown error');
      }
    },
    [toast],
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Files</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload documents, spreadsheets, and images. Agents can reference them via the{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">find_document</code> tool — use a
            name, tag, or describe the contents.
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          {docs.length} file{docs.length === 1 ? '' : 's'} &middot;{' '}
          {docs.filter((d) => d.status === 'INDEXED').length} indexed
        </div>
      </div>

      {/* Drop zone */}
      <Card
        onDragEnter={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-2 border-2 border-dashed p-10 transition-colors',
          dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/20',
          uploading && 'pointer-events-none opacity-70',
        )}
      >
        {uploading ? (
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        ) : (
          <CloudUpload className="h-8 w-8 text-muted-foreground" />
        )}
        <div className="text-center">
          <p className="text-sm font-medium">
            {uploading ? 'Uploading…' : 'Drop files here or click to upload'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            PDF, text, markdown, CSV, DOCX, XLSX, PNG, JPG, WEBP &middot; up to {MAX_SIZE_MB} MB
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={onFileChange}
          disabled={uploading}
        />
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
          Choose files
        </Button>
      </Card>

      {/* File grid */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : docs.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title="No files yet"
          description="Upload a document above and it'll be indexed for your agents within a few seconds."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {docs.map((doc) => {
            const Icon = iconFor(doc.mimeType);
            return (
              <Card key={doc.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={doc.fileName}>
                      {doc.fileName}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatBytes(doc.sizeBytes)} &middot;{' '}
                      {new Date(doc.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {statusBadge(doc.status)}
                  {doc.tags.map((t) => (
                    <Badge key={t} className="bg-slate-500/10 text-slate-500 text-[10px]">
                      {t}
                    </Badge>
                  ))}
                </div>
                {doc.ingestionError && (
                  <p className="text-xs text-red-500 line-clamp-2" title={doc.ingestionError}>
                    {doc.ingestionError}
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={() => onPreview(doc)} className="flex-1">
                    <Eye className="mr-1 h-3.5 w-3.5" /> Preview
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onDelete(doc.id, doc.fileName)}
                    disabled={deletingId === doc.id}
                  >
                    {deletingId === doc.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Preview overlay — simple signed-URL iframe for PDFs + images, download button otherwise */}
      {previewDoc && previewDoc.signedUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPreviewDoc(null)}
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{previewDoc.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(previewDoc.sizeBytes)} &middot; {previewDoc.mimeType}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPreviewDoc(null)}
                aria-label="Close preview"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-hidden">
              {previewDoc.mimeType === 'application/pdf' ||
              previewDoc.mimeType.startsWith('image/') ? (
                <iframe
                  src={previewDoc.signedUrl}
                  className="h-[75vh] w-full border-0"
                  title={previewDoc.fileName}
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 p-10 text-sm text-muted-foreground">
                  <FileType className="h-8 w-8" />
                  <p>Inline preview not supported for this file type.</p>
                  <Button asChild variant="outline" size="sm">
                    <a href={previewDoc.signedUrl} download={previewDoc.fileName}>
                      Download
                    </a>
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
