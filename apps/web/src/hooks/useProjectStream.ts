'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { connectSSE } from '@/lib/sse-fetch';

const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY = 1000;

export interface ProjectEvent {
  type: string;
  projectId?: string;
  timestamp?: string;
  [key: string]: unknown;
}

const TERMINAL_TYPES = new Set([
  'generation_completed', 'generation_failed',
  'iteration_completed', 'iteration_failed',
  'build_failed',
]);

/**
 * Hook for real-time project SSE events with reconnection logic.
 * Uses fetch-based SSE to send auth via Authorization header (not URL query params).
 */
export function useProjectStream(projectId: string | undefined) {
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!projectId) return;

    setEvents([]);

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

    const connect = async () => {
      if (cancelled) return;

      const token = await getToken();
      if (cancelled || !token) return;

      const url = `${BASE_URL}/projects/${projectId}/stream`;
      abortController = new AbortController();

      try {
        await connectSSE({
          url,
          token,
          signal: abortController.signal,
          onOpen: () => {
            if (!cancelled) {
              setIsConnected(true);
              reconnectAttemptRef.current = 0;
            }
          },
          onMessage: (data) => {
            if (cancelled) return;
            const event = data as ProjectEvent;
            setEvents(prev => [...prev, event]);

            if (TERMINAL_TYPES.has(event.type)) {
              abortController?.abort();
              setIsConnected(false);
              reconnectAttemptRef.current = MAX_RECONNECT_ATTEMPTS; // Prevent reconnect
            }
          },
          onError: () => {
            if (cancelled) return;
            setIsConnected(false);
            if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
              const delay = RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttemptRef.current);
              reconnectAttemptRef.current++;
              reconnectTimeoutRef.current = setTimeout(() => {
                if (!cancelled) void connect();
              }, delay);
            }
          },
        });
        // Stream ended gracefully
        if (!cancelled) setIsConnected(false);
      } catch {
        if (cancelled) return;
        setIsConnected(false);
        if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttemptRef.current);
          reconnectAttemptRef.current++;
          reconnectTimeoutRef.current = setTimeout(() => {
            if (!cancelled) void connect();
          }, delay);
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
      abortController?.abort();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      setIsConnected(false);
    };
  }, [projectId]);

  const clear = useCallback(() => setEvents([]), []);
  const latestEvent = events.length > 0 ? events[events.length - 1]! : null;

  return { events, latestEvent, isConnected, clear };
}
