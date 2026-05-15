import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import {
  ensureVenueCustomerIdForMergedContact,
  mergeVenueContacts,
} from '@/lib/merge-venue-contacts';
import { conversationHttpError } from '@/lib/conversation-db-errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isPlaceholderEmail(e: string): boolean {
  const x = e.trim().toLowerCase();
  return x.endsWith('@storypay.internal') || x.includes('@ghl-sms.storypay.placeholder');
}

async function resolveVenueCustomerIdForEmail(venueId: string, email: string): Promise<string | null> {
  const e = email.trim().toLowerCase();
  if (!e || !e.includes('@') || isPlaceholderEmail(e)) return null;

  const { data: merged } = await mergeVenueContacts(venueId, { search: e, page: 1, limit: 40 });
  const match = merged.find((c) => (c.email || '').trim().toLowerCase() === e);
  if (match) {
    return ensureVenueCustomerIdForMergedContact(venueId, match);
  }

  const { data: vc } = await supabaseAdmin
    .from('venue_customers')
    .select('id')
    .eq('venue_id', venueId)
    .ilike('customer_email', e)
    .maybeSingle();

  return (vc?.id as string | undefined) ?? null;
}

/**
 * GET /api/conversations/open-or-create?email=
 *
 * Resolves StoryVenue venue_customer (creating/linking via merge when needed),
 * then returns the most recent conversation thread for that contact or
 * creates one. Used from Contacts when `venueCustomerId` is not on the row.
 */
export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const email = request.nextUrl.searchParams.get('email')?.trim() ?? '';
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }

  const venueCustomerId = await resolveVenueCustomerIdForEmail(venueId, email);
  if (!venueCustomerId) {
    return NextResponse.json({ error: 'Contact not found for this venue' }, { status: 404 });
  }

  const { data: existing, error: listErr } = await supabaseAdmin
    .from('conversation_threads')
    .select('id')
    .eq('venue_id', venueId)
    .eq('venue_customer_id', venueCustomerId)
    .order('last_message_at', { ascending: false })
    .limit(1);

  if (listErr) {
    const { status, body } = conversationHttpError(listErr);
    return NextResponse.json(body, { status });
  }

  let threadId = (existing?.[0] as { id: string } | undefined)?.id;
  if (!threadId) {
    const { data: thread, error: insErr } = await supabaseAdmin
      .from('conversation_threads')
      .insert({
        venue_id: venueId,
        venue_customer_id: venueCustomerId,
        subject: 'Conversation',
      })
      .select('id')
      .single();

    if (insErr || !thread) {
      const { status, body } = conversationHttpError(insErr);
      return NextResponse.json(body, { status });
    }
    threadId = thread.id as string;
  }

  return NextResponse.json({ thread_id: threadId, venue_customer_id: venueCustomerId });
}
