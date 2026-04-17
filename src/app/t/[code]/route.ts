import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { onMarketingTriggerLinkClick } from '@/lib/marketing-email-worker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function safeRedirectUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 32 hex chars — matches leads.track_token (no dashes). */
const TRACK_TOKEN_RE = /^[0-9a-f]{32}$/i;

/**
 * Public short link: logs optional lead-attributed click, bumps stats, 302 to target_url.
 *
 * Attribution (same venue as the trigger link):
 * - ?t=<track_token> — preferred; each lead has a stable token (see Leads UI / API).
 * - ?l=<lead_uuid> — legacy; raw lead id still supported.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const trimmed = (code || '').trim();
  if (trimmed.length < 8) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: link, error } = await supabaseAdmin
    .from('trigger_links')
    .select('id, venue_id, target_url, click_count')
    .eq('short_code', trimmed)
    .maybeSingle();

  if (error || !link) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const dest = safeRedirectUrl(link.target_url as string);
  if (!dest) {
    return NextResponse.json({ error: 'Invalid destination' }, { status: 502 });
  }

  const rawT = request.nextUrl.searchParams.get('t')?.trim().toLowerCase() ?? '';
  const rawL = request.nextUrl.searchParams.get('l')?.trim() ?? '';

  let leadId: string | null = null;

  if (rawT && TRACK_TOKEN_RE.test(rawT)) {
    const { data: byToken } = await supabaseAdmin
      .from('leads')
      .select('id')
      .eq('track_token', rawT)
      .eq('venue_id', link.venue_id)
      .maybeSingle();
    if (byToken?.id) leadId = byToken.id;
  }

  if (!leadId && rawL && UUID_RE.test(rawL)) {
    const { data: byId } = await supabaseAdmin
      .from('leads')
      .select('id')
      .eq('id', rawL)
      .eq('venue_id', link.venue_id)
      .maybeSingle();
    if (byId?.id) leadId = byId.id;
  }

  const ua = request.headers.get('user-agent');
  const ref = request.headers.get('referer');

  await supabaseAdmin.from('lead_marketing_events').insert({
    venue_id: link.venue_id,
    lead_id: leadId,
    event_type: 'trigger_link_click',
    trigger_link_id: link.id,
    referrer: ref,
    user_agent: ua,
  });

  void onMarketingTriggerLinkClick(
    link.venue_id as string,
    leadId,
    String(link.id),
  );

  const nextCount = Number(link.click_count ?? 0) + 1;
  await supabaseAdmin.from('trigger_links').update({ click_count: nextCount }).eq('id', link.id);

  return NextResponse.redirect(dest, 302);
}
