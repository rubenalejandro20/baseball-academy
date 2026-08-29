import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

/**
 * Server-side proxy for the update_athlete_photo_by_code RPC — same
 * rationale as /api/athlete/lookup (real client IP for rate limiting).
 * The RPC itself enforces that photo_url can only point at the calling
 * athlete's own storage object; this route does not widen that.
 */
export async function POST(request: NextRequest) {
  let code: unknown;
  let photoUrl: unknown;
  try {
    ({ code, photoUrl } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  if (typeof code !== 'string' || code.trim().length === 0 || typeof photoUrl !== 'string' || photoUrl.trim().length === 0) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  const supabase = createClient();
  const { data, error } = await supabase.rpc('update_athlete_photo_by_code', {
    p_code: code,
    p_photo_url: photoUrl,
    p_ip: ip,
  });

  if (error) {
    return NextResponse.json({ error: 'Unable to update photo. Please try again later.' }, { status: 429 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Code not found.' }, { status: 404 });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
