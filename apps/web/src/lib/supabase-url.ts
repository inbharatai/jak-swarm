/**
 * Supabase project URL normalizer.
 *
 * Operators frequently paste the REST endpoint (`.../rest/v1`) from the
 * dashboard instead of the project origin (`https://<ref>.supabase.co`).
 * Supabase auth/storage clients require the project origin.
 */
export function normalizeSupabaseProjectUrl(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return '';

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed;
  }
}

export function hasRestPathSuffix(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return false;

  try {
    const pathname = new URL(trimmed).pathname.toLowerCase();
    return pathname === '/rest/v1' || pathname === '/rest/v1/';
  } catch {
    return /\/rest\/v1\/?$/i.test(trimmed);
  }
}
