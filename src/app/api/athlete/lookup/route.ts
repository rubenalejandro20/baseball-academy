import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

/**
 * Server-side proxy for the get_athlete_by_code RPC.
 *
 * This exists ONLY so the rate limiter inside the RPC can key off a real
 * client IP. A browser calling the RPC directly cannot supply a trustworthy
 * IP (anything it sends could be spoofed), whereas this route reads it from
 * Vercel's `x-forwarded-for` header, which reflects the actual connecting
 * client. Temporary — retired along with the PIN flow once athlete auth
 * moves to email OTP.
 */
export async function POST(request: NextRequest) {
  let code: unknown;
  try {
    ({ code } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  if (typeof code !== 'string' || code.trim().length === 0) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  const supabase = createClient();
  const { data, error } = await supabase.rpc('get_athlete_by_code', { p_code: code, p_ip: ip });

  if (error) {
    // Includes the rate-limit exception raised inside the function.
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  const athlete = Array.isArray(data) ? data[0] : null;
  if (!athlete) {
    return NextResponse.json({ athlete: null }, { status: 200 });
  }

  return NextResponse.json({ athlete }, { status: 200 });
}
