import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyMarketingUnsubscribeToken } from '@/lib/marketing-email-tokens';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/public/marketing/preferences?token=...
 * Public, no-login. Returns the recipient's current marketing-email subscription
 * state plus a tiny bit of context so the manage page can render.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')?.trim() ?? '';
  const parsed = verifyMarketingUnsubscribeToken(token);
  if (!parsed) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 400 });

  const [{ data: venue }, { data: lead }, { data: sup }] = await Promise.all([
    supabaseAdmin.from('venues').select('name').eq('id', parsed.venueId).maybeSingle(),
    supabaseAdmin
      .from('leads')
      .select('id, email, first_name, name, marketing_email_opt_in')
      .eq('id', parsed.leadId)
      .eq('venue_id', parsed.venueId)
      .maybeSingle(),
    supabaseAdmin
      .from('marketing_email_suppressions')
      .select('lead_id')
      .eq('venue_id', parsed.venueId)
      .eq('lead_id', parsed.leadId)
      .maybeSingle(),
  ]);

  if (!lead) return NextResponse.json({ error: 'Recipient not found' }, { status: 404 });

  const suppressed = !!sup;
  const optInFalse = (lead as { marketing_email_opt_in?: boolean }).marketing_email_opt_in === false;
  const subscribed = !suppressed && !optInFalse;

  return NextResponse.json({
    venueName: (venue?.name as string) || 'this venue',
    email: (lead.email as string) || '',
    firstName:
      (lead.first_name as string | null)?.trim() ||
      (lead.name as string | null)?.split(/\s+/)[0] ||
      '',
    subscribed,
  });
}

/**
 * POST /api/public/marketing/preferences
 * body: { token: string, subscribed: boolean }
 * Public, no-login. Sets the lead's subscription state for this venue's marketing emails.
 */
export async function POST(request: NextRequest) {
  let body: { token?: string; subscribed?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const subscribed = body.subscribed === true;
  const parsed = verifyMarketingUnsubscribeToken(token);
  if (!parsed) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 400 });

  if (subscribed) {
    // Resubscribe: clear suppression + set opt-in true.
    const { error: delErr } = await supabaseAdmin
      .from('marketing_email_suppressions')
      .delete()
      .eq('venue_id', parsed.venueId)
      .eq('lead_id', parsed.leadId);
    if (delErr) {
      console.error('[preferences POST] delete suppression', delErr);
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
    const { error: upErr } = await supabaseAdmin
      .from('leads')
      .update({ marketing_email_opt_in: true })
      .eq('id', parsed.leadId)
      .eq('venue_id', parsed.venueId);
    if (upErr) {
      console.error('[preferences POST] opt-in true', upErr);
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
  } else {
    // Unsubscribe: add suppression + set opt-in false.
    const { error: insErr } = await supabaseAdmin
      .from('marketing_email_suppressions')
      .upsert(
        {
          lead_id: parsed.leadId,
          venue_id: parsed.venueId,
          reason: 'unsubscribe',
        },
        { onConflict: 'lead_id,venue_id' },
      );
    if (insErr) {
      console.error('[preferences POST] insert suppression', insErr);
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
    const { error: upErr } = await supabaseAdmin
      .from('leads')
      .update({ marketing_email_opt_in: false })
      .eq('id', parsed.leadId)
      .eq('venue_id', parsed.venueId);
    if (upErr) {
      console.error('[preferences POST] opt-in false', upErr);
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, subscribed });
}
