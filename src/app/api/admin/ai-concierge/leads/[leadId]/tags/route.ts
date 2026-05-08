/**
 * GET  /api/admin/ai-concierge/leads/[leadId]/tags
 *   Returns the lead's current tags + all available tags for this venue.
 *
 * POST /api/admin/ai-concierge/leads/[leadId]/tags
 *   Adds a tag to the lead.
 *   Body: { tagId: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

async function getLeadVenueId(leadId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('leads')
    .select('venue_id')
    .eq('id', leadId)
    .single();
  return data?.venue_id ?? null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { leadId } = await params;
  const venueId = await getLeadVenueId(leadId);
  if (!venueId) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  // Current tags on this lead
  const { data: assigned } = await supabaseAdmin
    .from('lead_tag_assignments')
    .select('tag_id, marketing_tags(id, name, icon, color, is_system, system_key, category)')
    .eq('lead_id', leadId);

  // All available tags for this venue
  const { data: allTags } = await supabaseAdmin
    .from('marketing_tags')
    .select('id, name, icon, color, is_system, system_key, category, position')
    .eq('venue_id', venueId)
    .order('position', { ascending: true, nullsFirst: false });

  const assignedIds = new Set((assigned ?? []).map((a: { tag_id: string }) => a.tag_id));

  return NextResponse.json({
    assigned: (assigned ?? []).map((a: { tag_id: string; marketing_tags: unknown }) => a.marketing_tags),
    available: (allTags ?? []).filter((t: { id: string }) => !assignedIds.has(t.id)),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { leadId } = await params;
  const body = await req.json().catch(() => ({})) as { tagId?: string };
  if (!body.tagId) return NextResponse.json({ error: 'Missing tagId' }, { status: 400 });

  const venueId = await getLeadVenueId(leadId);
  if (!venueId) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  // Verify tag belongs to this venue
  const { data: tag } = await supabaseAdmin
    .from('marketing_tags')
    .select('id, venue_id')
    .eq('id', body.tagId)
    .eq('venue_id', venueId)
    .single();
  if (!tag) return NextResponse.json({ error: 'Tag not found for this venue' }, { status: 404 });

  const { error } = await supabaseAdmin
    .from('lead_tag_assignments')
    .upsert({ lead_id: leadId, tag_id: body.tagId, venue_id: venueId }, { onConflict: 'lead_id,tag_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
