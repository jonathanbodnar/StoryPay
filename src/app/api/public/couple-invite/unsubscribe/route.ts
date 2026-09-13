import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCoupleUnsubscribeToken } from '@/lib/couple-invite-tokens';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Public unsubscribe endpoint for couple website invites. Mirrors the venue
 * marketing unsubscribe flow: a signed token identifies the couple's wedding +
 * the recipient email, and we record a couple-scoped suppression so the address
 * is excluded from all future couple sends.
 */

async function suppress(coupleWeddingId: string, email: string, reason: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from('couple_email_suppressions').upsert(
    { couple_wedding_id: coupleWeddingId, email: email.trim().toLowerCase(), reason },
    { onConflict: 'couple_wedding_id,email' },
  );
  if (error) {
    // Fallback for environments where the unique index isn't the inferred
    // conflict target — check-then-insert so a repeat click never 500s.
    const { data: existing } = await supabaseAdmin
      .from('couple_email_suppressions')
      .select('id')
      .eq('couple_wedding_id', coupleWeddingId)
      .ilike('email', email.trim().toLowerCase())
      .maybeSingle();
    if (existing) return true;
    const { error: insErr } = await supabaseAdmin
      .from('couple_email_suppressions')
      .insert({ couple_wedding_id: coupleWeddingId, email: email.trim().toLowerCase(), reason });
    if (insErr) {
      console.error('[couple-invite unsubscribe]', insErr);
      return false;
    }
  }
  return true;
}

/**
 * RFC 8058 one-click unsubscribe — Gmail/Yahoo POST `List-Unsubscribe=One-Click`
 * to the same `?token=` URL used for human clicks.
 */
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')?.trim() ?? '';
  const parsed = verifyCoupleUnsubscribeToken(token);
  if (!parsed) return new NextResponse(null, { status: 400 });
  const ok = await suppress(parsed.coupleWeddingId, parsed.email, 'one_click_unsubscribe');
  return new NextResponse(null, { status: ok ? 200 : 500 });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')?.trim() ?? '';
  const parsed = verifyCoupleUnsubscribeToken(token);
  if (!parsed) {
    return new NextResponse(
      '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>Invalid link</h1><p>This unsubscribe link has expired or is invalid.</p></body></html>',
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
  const ok = await suppress(parsed.coupleWeddingId, parsed.email, 'unsubscribe');
  if (!ok) {
    return new NextResponse(
      '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>Something went wrong</h1><p>Please contact the couple directly.</p></body></html>',
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  return new NextResponse(
    `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center;max-width:480px;margin:0 auto">
      <h1 style="font-weight:600">You're unsubscribed</h1>
      <p style="color:#52525b">You won't receive any more wedding website invites from this couple through StoryVenue.</p>
    </body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
