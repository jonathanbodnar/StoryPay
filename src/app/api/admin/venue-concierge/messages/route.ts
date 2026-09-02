/**
 * Venue Concierge — admin (concierge) side.
 *
 * GET  /api/admin/venue-concierge/messages?venueId=  → history for one venue,
 *      marks the concierge-side read cursor current.
 * POST /api/admin/venue-concierge/messages           → concierge replies to a
 *      venue ({ venueId, body }).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySupportAccess } from '@/lib/support/auth';
import { ensureSuperAdminSupportMember, SUPER_ADMIN_SUPPORT_USER_ID } from '@/lib/support/super-admin-member';
import { broadcastVenueConciergeMessage } from '@/lib/realtime/broadcast';
import { notifyVenueOfConciergeMessage } from '@/lib/owner-notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface MsgRow {
  id: string;
  sender_kind: 'venue' | 'concierge';
  sender_support_user_id: string | null;
  sender_label: string | null;
  body: string;
  created_at: string;
}

export async function GET(req: NextRequest) {
  const { isSuperAdmin, agent } = await verifySupportAccess();
  if (!isSuperAdmin && !agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const venueId = req.nextUrl.searchParams.get('venueId')?.trim();
  if (!venueId) return NextResponse.json({ error: 'Missing venueId' }, { status: 400 });

  const { data: rows } = await supabaseAdmin
    .from('venue_concierge_messages')
    .select('id, sender_kind, sender_support_user_id, sender_label, body, created_at')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: true });
  const msgs = ((rows ?? []) as unknown) as MsgRow[];

  const supportIds = Array.from(
    new Set(msgs.map((m) => m.sender_support_user_id).filter((x): x is string => !!x)),
  );
  const nameById: Record<string, string> = {};
  if (supportIds.length > 0) {
    const { data: people } = await supabaseAdmin
      .from('support_team_members')
      .select('id, name, first_name, last_name')
      .in('id', supportIds);
    for (const p of (people ?? []) as Array<{ id: string; name: string | null; first_name: string | null; last_name: string | null }>) {
      nameById[p.id] = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.name || 'Concierge';
    }
  }

  const messages = msgs.map((m) => ({
    id: m.id,
    fromConcierge: m.sender_kind === 'concierge',
    body: m.body,
    createdAt: m.created_at,
    authorName: m.sender_kind === 'concierge'
      ? (m.sender_support_user_id ? (nameById[m.sender_support_user_id] || 'Concierge') : 'Concierge')
      : (m.sender_label || 'Venue'),
  }));

  await supabaseAdmin
    .from('venue_concierge_reads')
    .upsert(
      { venue_id: venueId, reader_ref: 'concierge', last_read_at: new Date().toISOString() },
      { onConflict: 'venue_id,reader_ref' },
    );

  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest) {
  const { isSuperAdmin, agent } = await verifySupportAccess();
  if (!isSuperAdmin && !agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: { venueId?: string; body?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const venueId = (payload.venueId || '').trim();
  const text = (payload.body || '').trim();
  if (!venueId) return NextResponse.json({ error: 'Missing venueId' }, { status: 400 });
  if (!text) return NextResponse.json({ error: 'Empty message' }, { status: 400 });

  // Resolve the concierge author: real agent session → synthetic super admin.
  let supportUserId = agent?.sub || '';
  if (!supportUserId && isSuperAdmin) {
    const sa = await ensureSuperAdminSupportMember();
    supportUserId = sa.id;
  }
  if (supportUserId === SUPER_ADMIN_SUPPORT_USER_ID) {
    await ensureSuperAdminSupportMember();
  }
  if (!supportUserId) {
    return NextResponse.json({ error: 'Sign in as a concierge agent.' }, { status: 400 });
  }

  const { data: msg, error } = await supabaseAdmin
    .from('venue_concierge_messages')
    .insert({
      venue_id: venueId,
      sender_kind: 'concierge',
      sender_support_user_id: supportUserId,
      body: text,
    })
    .select('id, created_at')
    .single();

  if (error || !msg) {
    return NextResponse.json({ error: error?.message || 'Failed to send' }, { status: 500 });
  }

  await supabaseAdmin
    .from('venue_concierge_reads')
    .upsert(
      { venue_id: venueId, reader_ref: 'concierge', last_read_at: new Date().toISOString() },
      { onConflict: 'venue_id,reader_ref' },
    );

  // Resolve author name for the live-append + email/push copy.
  let authorName = 'StoryVenue Concierge';
  try {
    const { data: person } = await supabaseAdmin
      .from('support_team_members')
      .select('name, first_name, last_name')
      .eq('id', supportUserId)
      .maybeSingle();
    if (person) {
      const p = person as { name: string | null; first_name: string | null; last_name: string | null };
      authorName = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.name || authorName;
    }
  } catch { /* best-effort */ }

  const created = msg as { id: string; created_at?: string };
  const createdAt = created.created_at || new Date().toISOString();

  void broadcastVenueConciergeMessage({
    venueId,
    direction: 'outbound',
    messageId: created.id,
    body: text,
    authorName,
    createdAt,
  });

  // Email + push the venue so they can reply from their inbox / mobile app.
  void notifyVenueOfConciergeMessage({ venueId, authorName, bodyPreview: text });

  return NextResponse.json({ ok: true, id: created.id });
}
