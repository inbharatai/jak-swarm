'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY = 1000; // 1 second, doubles each attempt

export interface ProjectEvent {
  type: string;
  projectId?: string;
  timestamp?: string;
  [key: string]: unknown;
}

/**
 * Hook for real-time project SSE events with reconnection logic.
 * FIX #24: Exponential backoff reconnection on disconnect.
 */
export function useProjectStream(projectId: string | undefined) {
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!projectId) return;

    // FIX: Clear events when projectId changes (new generation)
    setEvents([]);

    let cancelled = false;

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

      const url = `${BASE_URL}/projects/${projectId}/stream?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (!cancelled) {
          setIsConnected(true);
          reconnectAttemptRef.current = 0; // Reset on successful connection
        }
      };

      es.onmessage = (e) => {
        if (cancelled) return;
        try {
          const event = JSON.parse(e.data) as ProjectEvent;
          setEvents(prev => [...prev, event]);

          // Auto-close on terminal events — no reconnection needed
          if (event.type === 'generation_completed' || event.type === 'generation_failed' ||
              event.type === 'iteration_completed' || event.type === 'iteration_failed' ||
              event.type === 'build_failed') {
            es.close();
            setIsConnected(false);
            reconnectAttemptRef.current = MAX_RECONNECT_ATTEMPTS; // Prevent reconnect
          }
        } catch {
          // Ignore parse errors (heartbeats)
        }
      };

      es.onerror = () => {
        if (cancelled) return;
        setIsConnected(false);
        es.close();

        // FIX #24: Exponential backoff reconnection
        if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttemptRef.current);
          reconnectAttemptRef.current++;
          reconnectTimeoutRef.current = setTimeout(() => {
            if (!cancelled) void connect();
          }, delay);
        }
      };
    };

    void connect();

    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      setIsConnected(false);
    };
  }, [projectId]);

  const clear = useCallback(() => setEvents([]), []);
  const latestEvent = events.length > 0 ? events[events.length - 1]! : null;

  return { events, latestEvent, isConnected, clear };
}
