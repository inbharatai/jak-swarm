import { createBrowserClient } from '@supabase/ssr';
import { normalizeSupabaseProjectUrl } from './supabase-url';

// ─── Browser client (used in Client Components) ────────────────────────────
// This is a singleton that lives for the lifetime of the browser tab.
// It automatically handles token refresh via cookies.

export function createClient() {
  const supabaseUrl = normalizeSupabaseProjectUrl(process.env['NEXT_PUBLIC_SUPABASE_URL']);

  return createBrowserClient(
    supabaseUrl,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

// Convenience singleton for simple imports
let _client: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseClient() {
  if (!_client) {
    _client = createClient();
  }
  return _client;
}

export const isSupabaseConfigured = Boolean(
  normalizeSupabaseProjectUrl(process.env['NEXT_PUBLIC_SUPABASE_URL']) && process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
);
