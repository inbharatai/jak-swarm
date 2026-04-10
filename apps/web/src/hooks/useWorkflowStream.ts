'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface WorkflowEvent {
  type: string;
  workflowId?: string;
  status?: string;
  error?: string;
  timestamp?: string;
}

export function useWorkflowStream(workflowId: string | null) {
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [latestEvent, setLatestEvent] = useState<WorkflowEvent | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminalRef = useRef(false);

  useEffect(() => {
    if (!workflowId) return;
    retryCount.current = 0;
    terminalRef.current = false;

    function connect() {
      if (terminalRef.current) return;

      const token = typeof window !== 'undefined' ? localStorage.getItem('jak_token') : null;
      if (!token) return;

      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
      const url = `${apiUrl}/workflows/${workflowId}/stream?token=${encodeURIComponent(token)}`;

      try {
        const es = new EventSource(url);
        esRef.current = es;

        es.onopen = () => {
          setIsConnected(true);
          retryCount.current = 0;
        };

        es.onmessage = (evt) => {
          try {
            const event = JSON.parse(evt.data) as WorkflowEvent;
            setLatestEvent(event);
            setEvents((prev) => [...prev.slice(-49), event]);

            if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
              terminalRef.current = true;
              es.close();
              setIsConnected(false);
            }
          } catch { /* ignore malformed */ }
        };

        es.onerror = () => {
          setIsConnected(false);
          es.close();
          esRef.current = null;

          if (!terminalRef.current && retryCount.current < 5) {
            const delay = Math.min(1000 * Math.pow(2, retryCount.current), 30_000);
            retryCount.current++;
            retryTimer.current = setTimeout(connect, delay);
          }
        };
      } catch {
        // EventSource constructor failed
      }
    }

    connect();

    return () => {
      terminalRef.current = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      setIsConnected(false);
    };
  }, [workflowId]);

  const clear = useCallback(() => {
    setEvents([]);
    setLatestEvent(null);
  }, []);

  return { events, latestEvent, isConnected, clear };
}
