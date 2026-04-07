'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export interface ProjectEvent {
  type: string;
  projectId?: string;
  timestamp?: string;
  [key: string]: unknown;
}

/**
 * Hook for real-time project SSE events.
 * Follows the same pattern as useWorkflowStream.
 */
export function useProjectStream(projectId: string | undefined) {
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!projectId) return;

    // Get token for SSE auth
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

    let cancelled = false;

    const connect = async () => {
      const token = await getToken();
      if (cancelled || !token) return;

      const url = `${BASE_URL}/projects/${projectId}/stream?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (!cancelled) setIsConnected(true);
      };

      es.onmessage = (e) => {
        if (cancelled) return;
        try {
          const event = JSON.parse(e.data) as ProjectEvent;
          setEvents(prev => [...prev, event]);

          // Auto-close on terminal events
          if (event.type === 'generation_completed' || event.type === 'generation_failed' ||
              event.type === 'iteration_completed' || event.type === 'iteration_failed' ||
              event.type === 'build_failed') {
            es.close();
            setIsConnected(false);
          }
        } catch {
          // Ignore parse errors (heartbeats, etc.)
        }
      };

      es.onerror = () => {
        if (!cancelled) {
          setIsConnected(false);
          es.close();
        }
      };
    };

    void connect();

    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
      setIsConnected(false);
    };
  }, [projectId]);

  const clear = useCallback(() => setEvents([]), []);
  const latestEvent = events.length > 0 ? events[events.length - 1]! : null;

  return { events, latestEvent, isConnected, clear };
}
