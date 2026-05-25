import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { normalizeSupabaseProjectUrl } from './supabase-url';

// ─── Server client (used in Server Components, Route Handlers, Server Actions) ─
// Creates a new client per request to avoid sharing state between requests.

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const supabaseUrl = normalizeSupabaseProjectUrl(process.env['NEXT_PUBLIC_SUPABASE_URL']);

  return createServerClient(
    supabaseUrl,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    },
  );
}
