import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { getSessionUser } from '@/lib/session';
import { conversationReaderRef } from '@/lib/conversation-reader';
import { conversationHttpError } from '@/lib/conversation-db-errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** List threads + contact fields without PostgREST embeds (avoids FK/cache issues). */
async function fetchThreadsListManual(venueId: string) {
  const { data: rows, error: qErr } = await supabaseAdmin
    .from('conversation_threads')
    .select(
      'id, venue_id, venue_customer_id, subject, last_message_at, last_message_preview, last_message_visibility',
    )
    .eq('venue_id', venueId)
    .order('last_message_at', { ascending: false })
    .limit(120);

  if (qErr) return { ok: false as const, error: qErr };

  const customerIds = [
    ...new Set((rows ?? []).map((r) => r.venue_customer_id as string).filter(Boolean)),
  ];

  const byCustomer = new Map<
    string,
    { first_name?: string; last_name?: string; customer_email?: string }
  >();

  if (customerIds.length > 0) {
    const { data: contacts, error: cErr } = await supabaseAdmin
      .from('venue_customers')
      .select('id, first_name, last_name, customer_email')
      .eq('venue_id', venueId)
      .in('id', customerIds);

    if (cErr) return { ok: false as const, error: cErr };

    for (const c of contacts ?? []) {
      const row = c as {
        id: string;
        first_name?: string;
        last_name?: string;
        customer_email?: string;
      };
      byCustomer.set(row.id, {
        first_name: row.first_name,
        last_name: row.last_name,
        customer_email: row.customer_email,
      });
    }
  }

  const mapped = (rows ?? []).map((r) => {
    const vc = byCustomer.get(r.venue_customer_id as string);
    return {
      thread_id: r.id,
      venue_id: r.venue_id,
      venue_customer_id: r.venue_customer_id,
      subject: r.subject,
      last_message_at: r.last_message_at,
      last_message_preview: r.last_message_preview,
      last_message_visibility: r.last_message_visibility,
      unread_count: 0,
      contact_first_name: vc?.first_name ?? '',
      contact_last_name: vc?.last_name ?? '',
      contact_email: vc?.customer_email ?? '',
    };
  });

  return { ok: true as const, data: mapped };
}

export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const unreadOnly = request.nextUrl.searchParams.get('unread') === '1';
  const readerRef = conversationReaderRef(user);

  const { data, error } = await supabaseAdmin.rpc('conversation_threads_with_meta', {
    p_venue_id: venueId,
    p_reader_ref: readerRef,
    p_unread_only: unreadOnly,
    p_limit: 120,
  });

  if (error) {
    console.error('[conversations/threads GET rpc]', error);
    const manual = await fetchThreadsListManual(venueId);
    if (!manual.ok) {
      const { status, body } = conversationHttpError(manual.error);
      return NextResponse.json(body, { status });
    }
    return NextResponse.json(manual.data);
  }

  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const venueCustomerId = body.venue_customer_id as string | undefined;
  const subject = typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : 'Conversation';

  if (!venueCustomerId) {
    return NextResponse.json({ error: 'venue_customer_id is required' }, { status: 400 });
  }

  const { data: vc, error: vcErr } = await supabaseAdmin
    .from('venue_customers')
    .select('id')
    .eq('venue_id', venueId)
    .eq('id', venueCustomerId)
    .maybeSingle();

  if (vcErr || !vc) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  const { data: thread, error: insErr } = await supabaseAdmin
    .from('conversation_threads')
    .insert({
      venue_id: venueId,
      venue_customer_id: venueCustomerId,
      subject,
    })
    .select('id')
    .single();

  if (insErr || !thread) {
    console.error('[conversations/threads POST]', insErr);
    const { status, body } = conversationHttpError(insErr);
    return NextResponse.json(body, { status });
  }

  return NextResponse.json({ id: thread.id }, { status: 201 });
}
