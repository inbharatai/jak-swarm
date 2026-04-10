'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { connectSSE } from '@/lib/sse-fetch';

export interface WorkflowEvent {
  type: string;
  workflowId?: string;
  status?: string;
  error?: string;
  timestamp?: string;
}

const TERMINAL_TYPES = new Set(['completed', 'failed', 'cancelled']);

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

      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
      const url = `${apiUrl}/workflows/${workflowId}/stream`;

      abortController = new AbortController();

      try {
        await connectSSE({
          url,
          token,
          signal: abortController.signal,
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
            if (!terminalRef.current && !cancelled && retryCount.current < 5) {
              const delay = Math.min(1000 * Math.pow(2, retryCount.current), 30_000);
              retryCount.current++;
              retryTimer.current = setTimeout(connect, delay);
            }
          },
        });
        // Stream ended gracefully (server closed)
        if (!terminalRef.current && !cancelled) {
          setIsConnected(false);
        }
      } catch {
        // connectSSE threw (non-200, no body, etc.)
        setIsConnected(false);
        if (!terminalRef.current && !cancelled && retryCount.current < 5) {
          const delay = Math.min(1000 * Math.pow(2, retryCount.current), 30_000);
          retryCount.current++;
          retryTimer.current = setTimeout(connect, delay);
        }
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
