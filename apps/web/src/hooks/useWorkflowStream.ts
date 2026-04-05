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

  useEffect(() => {
    if (!workflowId) return;

    const token = typeof window !== 'undefined' ? localStorage.getItem('jak_token') : null;
    if (!token) return;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    const url = `${apiUrl}/workflows/${workflowId}/stream?token=${encodeURIComponent(token)}`;

    try {
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => setIsConnected(true);

      es.onmessage = (evt) => {
        try {
          const event = JSON.parse(evt.data) as WorkflowEvent;
          setLatestEvent(event);
          setEvents((prev) => [...prev.slice(-49), event]);

          if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
            es.close();
            setIsConnected(false);
          }
        } catch { /* ignore */ }
      };

      es.onerror = () => {
        setIsConnected(false);
        es.close();
      };

      return () => {
        es.close();
        setIsConnected(false);
      };
    } catch {
      return undefined;
    }
  }, [workflowId]);

  const clear = useCallback(() => {
    setEvents([]);
    setLatestEvent(null);
  }, []);

  return { events, latestEvent, isConnected, clear };
}
