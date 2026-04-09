'use client';

import { useState, useCallback } from 'react';

export interface ModuleRoute {
  path: string;
  params: Record<string, string>;
}

export function useModuleRouter(initialPath = '/') {
  const [route, setRoute] = useState<ModuleRoute>({
    path: initialPath,
    params: {},
  });

  const navigate = useCallback((path: string, params: Record<string, string> = {}) => {
    setRoute({ path, params });
  }, []);

  const goBack = useCallback(() => {
    setRoute(prev => {
      const parts = prev.path.split('/').filter(Boolean);
      if (parts.length <= 1) return { path: '/', params: {} };
      parts.pop();
      return { path: '/' + parts.join('/'), params: {} };
    });
  }, []);

  return {
    path: route.path,
    params: route.params,
    navigate,
    goBack,
  };
}
