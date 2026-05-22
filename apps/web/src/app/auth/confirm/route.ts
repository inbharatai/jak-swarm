import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const next = url.searchParams.get('next');
  const origin = url.origin;

  const destination = type === 'recovery'
    ? next ?? '/reset-password'
    : next ?? '/workspace';

  const redirectToMagic = (reason: string) =>
    NextResponse.redirect(`${origin}/login/magic?error=${encodeURIComponent(reason)}`);

  const redirectToDestination = () =>
    NextResponse.redirect(new URL(destination, origin));

  const supabase = await createServerSupabaseClient();

  // Support code-based callbacks as well as token-hash callbacks.
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return redirectToMagic('auth_confirm_error');
    }
    return redirectToDestination();
  }

  if (!tokenHash || !type) {
    return redirectToMagic('auth_confirm_missing_token');
  }

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email' | 'email_change',
  });

  if (error) {
    return redirectToMagic('auth_confirm_error');
  }

  return redirectToDestination();
}