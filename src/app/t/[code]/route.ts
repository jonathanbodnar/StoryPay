import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

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

/**
 * Public short link: logs optional lead-attributed click, bumps stats, 302 to target_url.
 * Append ?l=<lead_uuid> when sending to a known lead (must belong to the same venue).
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

  let leadId: string | null = request.nextUrl.searchParams.get('l');
  if (leadId && !UUID_RE.test(leadId)) {
    leadId = null;
  }
  if (leadId) {
    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('id')
      .eq('id', leadId)
      .eq('venue_id', link.venue_id)
      .maybeSingle();
    if (!lead) leadId = null;
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

  const nextCount = Number(link.click_count ?? 0) + 1;
  await supabaseAdmin.from('trigger_links').update({ click_count: nextCount }).eq('id', link.id);

  return NextResponse.redirect(dest, 302);
}
