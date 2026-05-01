export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { authenticateApiV1, corsPreflight, CORS_HEADERS } from '@/lib/api-v1-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { onMarketingTagAdded } from '@/lib/marketing-email-worker';
import { dispatchIntegrationEvent } from '@/lib/integration-events';

export async function OPTIONS() { return corsPreflight(); }

/**
 * Apply a tag to a contact (resolved by email).
 *
 * Body:
 *   { email: "lead@x.com", tag_id?: "...", tag_name?: "VIP" }
 *
 * - Either `tag_id` or `tag_name` must be provided.
 * - If the contact does not exist as a lead, one is created with status "new".
 * - Firing this tag will execute any workflows triggered by `tag_added`.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateApiV1(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    tag_id?: string;
    tag_name?: string;
  };

  const email = (body.email || '').trim().toLowerCase();
  const tagId = body.tag_id?.trim() || '';
  const tagName = body.tag_name?.trim() || '';
  if (!email) return NextResponse.json({ error: 'email_required' }, { status: 400, headers: CORS_HEADERS });
  if (!tagId && !tagName) return NextResponse.json({ error: 'tag_id_or_name_required' }, { status: 400, headers: CORS_HEADERS });

  // 1. Resolve the tag (create on-demand if only a name was given)
  let resolvedTagId = tagId;
  let resolvedTagName = '';
  if (resolvedTagId) {
    const { data } = await supabaseAdmin
      .from('marketing_tags')
      .select('id, name')
      .eq('venue_id', auth.venueId)
      .eq('id', resolvedTagId)
      .maybeSingle();
    if (!data) return NextResponse.json({ error: 'tag_not_found' }, { status: 404, headers: CORS_HEADERS });
    resolvedTagName = (data as { name: string }).name;
  } else {
    const { data: existing } = await supabaseAdmin
      .from('marketing_tags')
      .select('id, name')
      .eq('venue_id', auth.venueId)
      .ilike('name', tagName)
      .maybeSingle();
    if (existing) {
      resolvedTagId = (existing as { id: string }).id;
      resolvedTagName = (existing as { name: string }).name;
    } else {
      // Create a new venue tag so future Zaps can target it
      const { data: created, error } = await supabaseAdmin
        .from('marketing_tags')
        .insert({ venue_id: auth.venueId, name: tagName, icon: '🏷️' })
        .select('id, name')
        .single();
      if (error || !created) {
        return NextResponse.json({ error: 'tag_create_failed' }, { status: 500, headers: CORS_HEADERS });
      }
      resolvedTagId = (created as { id: string }).id;
      resolvedTagName = (created as { name: string }).name;
    }
  }

  // 2. Resolve the lead (create on-demand)
  let { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id')
    .eq('venue_id', auth.venueId)
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lead) {
    const { data: newLead, error: insErr } = await supabaseAdmin
      .from('leads')
      .insert({ venue_id: auth.venueId, email, name: email, status: 'new', source: 'api' })
      .select('id')
      .single();
    if (insErr || !newLead) {
      return NextResponse.json({ error: 'lead_create_failed' }, { status: 500, headers: CORS_HEADERS });
    }
    lead = newLead as { id: string };
  }
  const leadId = (lead as { id: string }).id;

  // 3. Insert assignment (no-op if it already exists)
  const { error: insAssign } = await supabaseAdmin
    .from('lead_tag_assignments')
    .insert({ lead_id: leadId, tag_id: resolvedTagId, venue_id: auth.venueId });

  // Code 23505 = unique violation. Treat as "already applied" — not an error.
  const alreadyApplied = !!insAssign && (insAssign as { code?: string }).code === '23505';
  if (insAssign && !alreadyApplied) {
    return NextResponse.json({ error: insAssign.message }, { status: 500, headers: CORS_HEADERS });
  }

  // 4. Fire workflow trigger + integration event (only if newly applied)
  if (!alreadyApplied) {
    void onMarketingTagAdded(auth.venueId, leadId, [resolvedTagId]);
    void dispatchIntegrationEvent(auth.venueId, 'tag.added', {
      lead_id: leadId,
      email,
      tag: { id: resolvedTagId, name: resolvedTagName },
    });
  }

  return NextResponse.json(
    {
      success: true,
      already_applied: alreadyApplied,
      lead_id: leadId,
      tag: { id: resolvedTagId, name: resolvedTagName },
    },
    { headers: CORS_HEADERS },
  );
}
