'use client';

import React, { useEffect, useState } from 'react';
import useSWR from 'swr';
import { apiDataFetch, whatsappApi } from '@/lib/api-client';
import { Badge, Button, Card, CardContent, Input, Spinner } from '@/components/ui';
import { useToast } from '@/components/ui/toast';

export type WhatsAppStatus = 'starting' | 'qr' | 'connected' | 'disconnected' | 'error';

interface WhatsAppStatusPayload {
  status: WhatsAppStatus;
  qr?: string;
  message?: string;
}

const STATUS_LABELS: Record<WhatsAppStatus, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  connected: { label: 'Connected', variant: 'success' },
  qr: { label: 'Waiting for scan', variant: 'warning' },
  starting: { label: 'Starting', variant: 'secondary' },
  disconnected: { label: 'Disconnected', variant: 'secondary' },
  error: { label: 'Error', variant: 'destructive' },
};

export function WhatsAppControl() {
  const toast = useToast();
  const { data, error, isLoading } = useSWR<WhatsAppStatusPayload>(
    '/whatsapp/status',
    (url: string) => apiDataFetch<WhatsAppStatusPayload>(url),
    { refreshInterval: 5000 },
  );
  const {
    data: numberData,
    isLoading: numberLoading,
    mutate: mutateNumber,
  } = useSWR<{ number: string | null; status: string; verificationCode?: string | null; expiresAt?: string | null; verifiedAt?: string | null }>(
    '/whatsapp/number',
    () => whatsappApi.getNumber(),
  );

  const [numberInput, setNumberInput] = useState('');
  const [numberError, setNumberError] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [hasEdited, setHasEdited] = useState(false);

  useEffect(() => {
    if (!hasEdited && numberData?.number) {
      setNumberInput(numberData.number);
    }
  }, [hasEdited, numberData?.number]);

  const status = data?.status ?? 'disconnected';
  const statusMeta = STATUS_LABELS[status];
  const linkStatus = numberData?.status ?? 'PENDING';
  const isLinked = linkStatus === 'VERIFIED' && Boolean(numberData?.number);
  const isPending = linkStatus === 'PENDING';
  const isExpired = linkStatus === 'EXPIRED';

  const handleSave = async () => {
    const trimmed = numberInput.trim();
    setNumberError(undefined);
    if (!trimmed) {
      setNumberError('Enter a phone number with country code.');
      return;
    }

    setIsSaving(true);
    try {
      const result = await whatsappApi.setNumber(trimmed);
      setNumberInput(result.number);
      setHasEdited(false);
      await mutateNumber({ number: result.number, status: result.status, verificationCode: result.verificationCode, expiresAt: result.expiresAt, verifiedAt: result.verifiedAt }, false);
      toast.success('WhatsApp number saved', 'Scan the QR code to finish linking.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Please try again.';
      toast.error('Failed to save number', message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    if (!confirm('Remove the linked WhatsApp number?')) return;
    setIsClearing(true);
    try {
      await whatsappApi.clearNumber();
      setNumberInput('');
      setHasEdited(false);
      await mutateNumber({ number: null, status: 'PENDING', verificationCode: null, expiresAt: null, verifiedAt: null }, false);
      toast.info('WhatsApp number removed');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Please try again.';
      toast.error('Failed to remove number', message);
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">WhatsApp Control</h2>
            <p className="text-sm text-muted-foreground">
              Pair once via QR code, then control workflows from your phone. No Twilio required.
            </p>
          </div>
          <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
        </div>

        <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-background to-transparent p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">Step 1</p>
              <p className="text-sm font-medium">Register your control number</p>
              <p className="text-xs text-muted-foreground">Use the number that will send WhatsApp commands.</p>
              {numberLoading && (
                <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Loading number…</p>
              )}
            </div>
            {numberData?.number && (
              <Badge variant={isLinked ? 'success' : isExpired ? 'destructive' : 'warning'}>
                {linkStatus}: {numberData?.number}
              </Badge>
            )}
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                label="WhatsApp number"
                placeholder="+14155551234"
                value={numberInput}
                onChange={(e) => {
                  setNumberInput(e.target.value);
                  setHasEdited(true);
                }}
                error={numberError}
                hint={!numberError ? 'Include country code, digits only.' : undefined}
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleSave}
                disabled={isSaving || numberLoading}
                className="gap-2"
              >
                {isSaving ? <Spinner size="sm" /> : 'Save'}
              </Button>
              {isLinked && (
                <Button
                  variant="outline"
                  onClick={handleClear}
                  disabled={isClearing}
                >
                  {isClearing ? 'Removing...' : 'Remove'}
                </Button>
              )}
            </div>
          </div>
        </div>

        {(isPending || isExpired) && numberData?.number && (
          <div className="rounded-2xl border border-border bg-muted/30 p-4 space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Step 2</p>
              <p className="text-sm font-medium">Verify ownership</p>
              <p className="text-xs text-muted-foreground">
                Send the code below to your WhatsApp client from {numberData.number}.
              </p>
            </div>
            {numberData?.verificationCode && isPending ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                <div className="text-xs text-emerald-400 uppercase tracking-[0.2em]">Verification Code</div>
                <div className="mt-1 text-2xl font-mono tracking-[0.4em] text-emerald-300">
                  {numberData.verificationCode}
                </div>
                {numberData.expiresAt && (
                  <div className="mt-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    Expires {new Date(numberData.expiresAt).toLocaleTimeString()}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                Verification code expired. Save the number again to generate a new code.
              </div>
            )}
          </div>
        )}

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner size="sm" />
            Checking WhatsApp status...
          </div>
        )}

        {error && (
          <div className="text-sm text-destructive">
            Failed to load WhatsApp status. Check API connectivity.
          </div>
        )}

        {!isLoading && !error && status === 'qr' && data?.qr && (
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-2xl bg-white p-3 shadow-lg shadow-black/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={data.qr}
                alt="WhatsApp QR code — scan with your phone"
                width={220}
                height={220}
                className="block rounded"
              />
            </div>
            <div className="text-center text-xs text-muted-foreground">
              Open WhatsApp → Settings → Linked Devices → Link a Device
            </div>
          </div>
        )}

        {!isLoading && !error && status === 'connected' && (
          <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4 text-sm text-green-700 dark:text-green-400">
            WhatsApp is linked. Send "help" to see available commands.
          </div>
        )}

        {!isLoading && !error && (status === 'disconnected' || status === 'error' || status === 'starting') && (
          <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">Start the WhatsApp client</p>
            <div className="rounded-md bg-black/80 text-green-300 font-mono text-xs p-3">
              pnpm --filter @jak-swarm/whatsapp-client dev
            </div>
            {data?.message && <p className="text-xs">{data.message}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
