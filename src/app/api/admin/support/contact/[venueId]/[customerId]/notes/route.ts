/**
 * Notes for a contact, viewed/edited from the super-admin support inbox.
 *
 * Writes hit `customer_notes` — the same table the venue's contact-profile
 * page reads/writes. That's how notes added on the support side show up
 * automatically inside the venue subaccount: there's literally one row, in
 * one table, scoped to the (venue_id, customer_id) pair.
 *
 *   GET    list notes (newest first)
 *   POST   { content } → create
 *   PATCH  { noteId, content } → edit
 *   DELETE ?noteId=… → remove
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySupportAccess } from '@/lib/support/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ venueId: string; customerId: string }> };

async function authorName(): Promise<string> {
  const auth = await verifySupportAccess();
  if (auth.agent?.name) return `${auth.agent.name} (StoryPay support)`;
  if (auth.isSuperAdmin) return 'StoryPay support';
  return 'StoryPay support';
}

async function ensureAuthorized(): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const auth = await verifySupportAccess();
  if (!auth.isSuperAdmin && !auth.agent) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { ok: true };
}

async function ensureCustomerInVenue(venueId: string, customerId: string) {
  const { data } = await supabaseAdmin
    .from('venue_customers')
    .select('id')
    .eq('id', customerId)
    .eq('venue_id', venueId)
    .maybeSingle();
  return !!data;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await ensureAuthorized();
  if (!guard.ok) return guard.res;
  const { venueId, customerId } = await params;

  if (!(await ensureCustomerInVenue(venueId, customerId))) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from('customer_notes')
    .select('id, content, author_name, created_at')
    .eq('venue_id', venueId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[admin/support contact notes GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ notes: data ?? [] });
}

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await ensureAuthorized();
  if (!guard.ok) return guard.res;
  const { venueId, customerId } = await params;

  if (!(await ensureCustomerInVenue(venueId, customerId))) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  let body: { content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const content = (body.content || '').trim();
  if (!content) return NextResponse.json({ error: 'Content is required' }, { status: 400 });

  const author = await authorName();

  const { data, error } = await supabaseAdmin
    .from('customer_notes')
    .insert({
      venue_id:    venueId,
      customer_id: customerId,
      content,
      author_name: author,
    })
    .select('id, content, author_name, created_at')
    .single();

  if (error || !data) {
    console.error('[admin/support contact notes POST]', error);
    return NextResponse.json({ error: error?.message ?? 'Failed to save note' }, { status: 500 });
  }

  // Best-effort activity log so the venue's contact timeline shows the note
  // even though it was added from the support side.
  await supabaseAdmin.from('customer_activity').insert({
    venue_id: venueId,
    customer_id: customerId,
    activity_type: 'note_added',
    title: 'Note added (StoryPay support)',
    description: content.slice(0, 120),
  }).then(() => {}, () => {});

  return NextResponse.json({ note: data }, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await ensureAuthorized();
  if (!guard.ok) return guard.res;
  const { venueId, customerId } = await params;

  let body: { noteId?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const noteId = body.noteId;
  const content = (body.content || '').trim();
  if (!noteId) return NextResponse.json({ error: 'noteId is required' }, { status: 400 });
  if (!content) return NextResponse.json({ error: 'Content is required' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('customer_notes')
    .update({ content })
    .eq('id', noteId)
    .eq('venue_id', venueId)
    .eq('customer_id', customerId)
    .select('id, content, author_name, created_at')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  return NextResponse.json({ note: data });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await ensureAuthorized();
  if (!guard.ok) return guard.res;
  const { venueId, customerId } = await params;

  const noteId = req.nextUrl.searchParams.get('noteId');
  if (!noteId) return NextResponse.json({ error: 'noteId is required' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('customer_notes')
    .delete()
    .eq('id', noteId)
    .eq('venue_id', venueId)
    .eq('customer_id', customerId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
