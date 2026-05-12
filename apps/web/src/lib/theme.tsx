'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme | ((theme: Theme) => Theme)) => void;
  resolvedTheme: ResolvedTheme;
  systemTheme: ResolvedTheme;
  themes: Theme[];
}

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  enableSystem?: boolean;
  attribute?: 'class' | 'data-theme';
}

const STORAGE_KEY = 'theme';
const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStoredTheme(defaultTheme: Theme): Theme {
  if (typeof window === 'undefined') return defaultTheme;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : defaultTheme;
}

function applyTheme(theme: Theme, systemTheme: ResolvedTheme, attribute: 'class' | 'data-theme'): void {
  if (typeof document === 'undefined') return;
  const resolved = theme === 'system' ? systemTheme : theme;
  const root = document.documentElement;
  if (attribute === 'class') {
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
  } else {
    root.setAttribute(attribute, resolved);
  }
  root.style.colorScheme = resolved;
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  enableSystem = true,
  attribute = 'class',
}: ThemeProviderProps) {
  const initialTheme = enableSystem ? defaultTheme : defaultTheme === 'system' ? 'dark' : defaultTheme;
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme(initialTheme));
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemTheme(getSystemTheme());
    query.addEventListener('change', onChange);
    onChange();
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    applyTheme(theme, systemTheme, attribute);
  }, [theme, systemTheme, attribute]);

  const setTheme = useCallback((next: Theme | ((theme: Theme) => Theme)) => {
    setThemeState((current) => {
      const value = typeof next === 'function' ? next(current) : next;
      const normalized = !enableSystem && value === 'system' ? 'dark' : value;
      window.localStorage.setItem(STORAGE_KEY, normalized);
      return normalized;
    });
  }, [enableSystem]);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    setTheme,
    resolvedTheme: theme === 'system' ? systemTheme : theme,
    systemTheme,
    themes: enableSystem ? ['light', 'dark', 'system'] : ['light', 'dark'],
  }), [enableSystem, setTheme, systemTheme, theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext) ?? {
    theme: 'system',
    setTheme: () => {},
    resolvedTheme: 'dark',
    systemTheme: 'dark',
    themes: ['light', 'dark', 'system'],
  };
}
