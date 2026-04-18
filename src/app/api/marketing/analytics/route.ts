import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { count: sentCount } = await supabaseAdmin
    .from('marketing_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .eq('status', 'sent');

  const { count: openedCount } = await supabaseAdmin
    .from('marketing_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .eq('status', 'sent')
    .not('opened_at', 'is', null);

  const { data: formRows } = await supabaseAdmin
    .from('marketing_form_submissions')
    .select('form_id')
    .eq('venue_id', venueId)
    .limit(2000);

  const counts: Record<string, number> = {};
  for (const r of formRows ?? []) {
    const fid = (r as { form_id: string }).form_id;
    counts[fid] = (counts[fid] ?? 0) + 1;
  }
  const formIds = Object.keys(counts);
  const names = new Map<string, string>();
  if (formIds.length > 0) {
    const { data: forms } = await supabaseAdmin.from('marketing_forms').select('id, name').in('id', formIds);
    for (const f of forms ?? []) names.set((f as { id: string }).id, (f as { name: string }).name);
  }
  const formSubmissions = formIds.map((formId) => ({
    formId,
    name: names.get(formId) || 'Form',
    count: counts[formId] ?? 0,
  }));

  return NextResponse.json({
    emailsSent: sentCount ?? 0,
    emailsOpened: openedCount ?? 0,
    formSubmissions,
  });
}
