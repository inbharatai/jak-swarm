'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getRawToken } from '@/lib/auth';
import { connectSSE } from '@/lib/sse-fetch';

export interface WorkflowEvent {
  type: string;
  workflowId?: string;
  status?: string;
  error?: string;
  timestamp?: string;
}

const TERMINAL_TYPES = new Set(['completed', 'failed', 'cancelled']);
const DEV_BYPASS_ACTIVE = process.env['NEXT_PUBLIC_JAK_DEV_AUTH_BYPASS'] === '1';
const DEV_BYPASS_TOKEN = 'jak-dev-bypass';

export function useWorkflowStream(workflowId: string | null) {
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [latestEvent, setLatestEvent] = useState<WorkflowEvent | null>(null);
  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminalRef = useRef(false);

  useEffect(() => {
    if (!workflowId) return;
    retryCount.current = 0;
    terminalRef.current = false;

    let cancelled = false;
    let abortController: AbortController | null = null;

    const getToken = async (): Promise<string | null> => {
      if (DEV_BYPASS_ACTIVE) return DEV_BYPASS_TOKEN;

      const localToken = getRawToken();
      if (localToken) return localToken;

      try {
        const { createClient } = await import('@/lib/supabase');
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        return data?.session?.access_token ?? null;
      } catch {
        return null;
      }
    };

    async function connect() {
      if (terminalRef.current || cancelled) return;

      const token = await getToken();
      if (!token || cancelled) return;

      // P0-A: use the guarded URL builder so production builds never stream
      // against localhost when NEXT_PUBLIC_API_URL is missing.
      const { buildApiUrl } = await import('@/lib/api-client');
      const url = buildApiUrl(`/workflows/${workflowId}/stream`);

      abortController = new AbortController();

      try {
        await connectSSE({
          url,
          token,
          signal: abortController.signal,
          maxRetries: 5,
          onOpen: () => {
            setIsConnected(true);
            retryCount.current = 0;
          },
          onMessage: (data) => {
            const event = data as WorkflowEvent;
            setLatestEvent(event);
            setEvents((prev) => [...prev.slice(-49), event]);

            if (TERMINAL_TYPES.has(event.type)) {
              terminalRef.current = true;
              abortController?.abort();
              setIsConnected(false);
            }
          },
          onError: () => {
            setIsConnected(false);
          },
        });
        // Stream ended gracefully (server closed)
        if (!terminalRef.current && !cancelled) {
          setIsConnected(false);
        }
      } catch {
        // connectSSE threw after all retries exhausted (non-200, no body, etc.)
        setIsConnected(false);
      }
    }

    connect();

    return () => {
      cancelled = true;
      terminalRef.current = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      abortController?.abort();
      setIsConnected(false);
    };
  }, [workflowId]);

  const clear = useCallback(() => {
    setEvents([]);
    setLatestEvent(null);
  }, []);

  return { events, latestEvent, isConnected, clear };
}
