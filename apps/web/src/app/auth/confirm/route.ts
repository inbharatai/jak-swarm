import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const next = url.searchParams.get('next');
  const origin = url.origin;

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}/login?error=auth_confirm_error`);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email' | 'email_change',
  });

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_confirm_error`);
  }

  const destination = type === 'recovery'
    ? next ?? '/reset-password'
    : next ?? '/workspace';

  return NextResponse.redirect(new URL(destination, origin));
}