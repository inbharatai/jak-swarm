'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useShellStore, serializeLayout } from '@/store/shell-store';
import { apiFetch } from '@/lib/api-client';

const STORAGE_KEY = 'jak-shell-layout';
const DEBOUNCE_MS = 2000;

/**
 * Persists shell layout to localStorage (instant) and optionally to backend.
 * Hydrates on mount from localStorage first, then backend if available.
 */
export function useLayoutPersistence() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedRef = useRef(false);

  // Hydrate layout on mount
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    let hydratedFromLocal = false;

    // Try localStorage first (fastest)
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        useShellStore.getState().hydrateLayout(parsed);
        hydratedFromLocal = true;
      }
    } catch {
      // ignore corrupt local storage
    }

    // Only use backend if localStorage had nothing (avoids race condition overwriting user interaction)
    if (!hydratedFromLocal) {
      apiFetch<{ data: { layout: ReturnType<typeof serializeLayout> } }>('/layouts/current')
        .then(res => {
          if (res?.data?.layout) {
            useShellStore.getState().hydrateLayout(res.data.layout);
            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(res.data.layout));
            } catch { /* quota */ }
          }
        })
        .catch(() => {
          // Backend unavailable, local state is fine
        });
    }
  }, []);

  // Save layout on changes (debounced)
  const saveLayout = useCallback(() => {
    const serialized = serializeLayout();

    // Save to localStorage immediately
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
    } catch { /* quota */ }

    // Debounce backend save
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      apiFetch('/layouts/current', {
        method: 'PUT',
        body: { layout: serialized },
      }).catch(() => {
        // Silent fail — local state preserved
      });
    }, DEBOUNCE_MS);
  }, []);

  // Subscribe to layout-related store changes
  useEffect(() => {
    const unsubscribe = useShellStore.subscribe(
      (state) => ({
        layoutTree: state.layoutTree,
        openModules: state.openModules,
        floatingWindows: state.floatingWindows,
        minimizedModules: state.minimizedModules,
        dockOrder: state.dockOrder,
      }),
      (_current, _prev) => {
        saveLayout();
      },
      { equalityFn: (a, b) =>
        a.layoutTree === b.layoutTree &&
        a.openModules === b.openModules &&
        a.floatingWindows === b.floatingWindows &&
        a.minimizedModules === b.minimizedModules &&
        a.dockOrder === b.dockOrder
      },
    );
    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [saveLayout]);
}
