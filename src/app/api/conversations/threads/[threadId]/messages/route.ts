import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { getSessionUser } from '@/lib/session';
import { sendEmail } from '@/lib/email';
import { conversationReaderRef } from '@/lib/conversation-reader';
import { findOrCreateContact, getGhlToken, normalizePhone, sendSms } from '@/lib/ghl';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PLACEHOLDER_SMS_EMAIL_DOMAIN = 'ghl-sms.storypay.placeholder';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function assertThreadVenue(threadId: string, venueId: string) {
  const { data, error } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, subject, venue_customer_id, external_reply_channel')
    .eq('id', threadId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: 'Not found' };
  return { ok: true as const, thread: data };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { threadId } = await params;
  const gate = await assertThreadVenue(threadId, venueId);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.error === 'Not found' ? 404 : 500 });

  const { data: messages, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const memberIds = new Set<string>();
  for (const m of messages ?? []) {
    if (m.venue_team_member_id) memberIds.add(m.venue_team_member_id as string);
  }
  let memberNames: Record<string, string> = {};
  if (memberIds.size > 0) {
    const { data: members } = await supabaseAdmin
      .from('venue_team_members')
      .select('id, first_name, last_name, name')
      .eq('venue_id', venueId)
      .in('id', [...memberIds]);
    for (const mem of members ?? []) {
      const row = mem as {
        id: string;
        first_name?: string;
        last_name?: string;
        name?: string;
      };
      memberNames[row.id] =
        [row.first_name, row.last_name].filter(Boolean).join(' ') || row.name || 'Team member';
    }
  }

  const enriched = (messages ?? []).map((m) => ({
    ...m,
    author_label:
      m.sender_kind === 'owner'
        ? 'Owner'
        : m.sender_kind === 'contact'
          ? (m.contact_from_name as string) || 'Contact'
          : m.sender_kind === 'system'
            ? 'System'
            : memberNames[m.venue_team_member_id as string] || 'Team member',
  }));

  return NextResponse.json(enriched);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { threadId } = await params;
  const gate = await assertThreadVenue(threadId, venueId);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.error === 'Not found' ? 404 : 500 });

  const body = await request.json();
  const visibility = body.visibility as string | undefined;
  const rawBody = typeof body.body === 'string' ? body.body.trim() : '';
  const mentionedIds = Array.isArray(body.mentioned_member_ids)
    ? (body.mentioned_member_ids as string[]).filter((id) => typeof id === 'string')
    : [];

  if (visibility !== 'internal' && visibility !== 'external') {
    return NextResponse.json({ error: 'visibility must be internal or external' }, { status: 400 });
  }
  if (!rawBody) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 });
  }

  if (visibility === 'internal' && mentionedIds.length > 0) {
    const { data: valid } = await supabaseAdmin
      .from('venue_team_members')
      .select('id')
      .eq('venue_id', venueId)
      .in('id', mentionedIds);
    const ok = new Set((valid ?? []).map((r) => (r as { id: string }).id));
    const filtered = mentionedIds.filter((id) => ok.has(id));
    if (filtered.length !== mentionedIds.length) {
      return NextResponse.json({ error: 'Invalid @mention target' }, { status: 400 });
    }
  }

  if (visibility === 'external' && mentionedIds.length > 0) {
    return NextResponse.json(
      { error: 'Client-visible messages cannot include @team mentions. Switch to Team only.' },
      { status: 400 },
    );
  }

  const sender_kind = user.memberId ? 'team' : 'owner';
  const venue_team_member_id = user.memberId ?? null;

  let external_email_sent = false;
  let send_error: string | null = null;

  const replyChannel =
    (gate.thread as { external_reply_channel?: string }).external_reply_channel ?? 'email';

  if (visibility === 'external') {
    if (replyChannel === 'sms') {
      const { data: contact } = await supabaseAdmin
        .from('venue_customers')
        .select('customer_email, first_name, last_name, phone, ghl_contact_id')
        .eq('id', gate.thread.venue_customer_id)
        .eq('venue_id', venueId)
        .maybeSingle();

      const { data: vrow } = await supabaseAdmin
        .from('venues')
        .select('ghl_access_token, ghl_location_id, ghl_connected')
        .eq('id', venueId)
        .single();

      if (!(vrow as { ghl_connected?: boolean } | null)?.ghl_connected || !vrow?.ghl_location_id) {
        return NextResponse.json(
          {
            error:
              'Connect Go High Level messaging for this venue (Settings → Integrations) to send SMS from Conversations.',
          },
          { status: 400 },
        );
      }

      const ghlToken = getGhlToken(vrow as { ghl_access_token?: string | null });
      if (!ghlToken) {
        return NextResponse.json({ error: 'GHL credentials are not configured for this venue.' }, { status: 400 });
      }

      const phoneE164 = normalizePhone((contact as { phone?: string | null } | null)?.phone ?? null);
      if (!phoneE164) {
        return NextResponse.json(
          { error: 'This contact needs a phone number on their profile to send SMS.' },
          { status: 400 },
        );
      }

      const email = ((contact as { customer_email?: string } | null)?.customer_email ?? '').trim();
      const firstName = (contact as { first_name?: string } | null)?.first_name ?? '';
      const lastName = (contact as { last_name?: string } | null)?.last_name ?? '';
      let contactId = (contact as { ghl_contact_id?: string | null } | null)?.ghl_contact_id ?? null;

      try {
        if (!contactId) {
          contactId = await findOrCreateContact(ghlToken, vrow.ghl_location_id as string, {
            email: email || `ghl.${gate.thread.venue_customer_id}@${PLACEHOLDER_SMS_EMAIL_DOMAIN}`,
            phone: phoneE164,
            firstName,
            lastName,
          });
          await supabaseAdmin
            .from('venue_customers')
            .update({ ghl_contact_id: contactId })
            .eq('id', gate.thread.venue_customer_id)
            .eq('venue_id', venueId);
        }
        if (!contactId) {
          throw new Error('Could not resolve Go High Level contact for this phone number.');
        }
        await sendSms(ghlToken, vrow.ghl_location_id as string, contactId, rawBody);
        external_email_sent = true;
      } catch (e) {
        send_error = e instanceof Error ? e.message : 'SMS send failed';
        console.warn('[conversations] external SMS failed:', send_error);
      }
    } else {
      const { data: contact } = await supabaseAdmin
        .from('venue_customers')
        .select('customer_email, first_name, last_name')
        .eq('id', gate.thread.venue_customer_id)
        .eq('venue_id', venueId)
        .maybeSingle();

      const to = (contact as { customer_email?: string } | null)?.customer_email?.trim();
      if (!to) {
        return NextResponse.json({ error: 'Contact has no email — add one on their profile first.' }, { status: 400 });
      }

      const { data: venue } = await supabaseAdmin
        .from('venues')
        .select('name, brand_email')
        .eq('id', venueId)
        .single();

      const venueName = (venue as { name?: string })?.name ?? 'Venue';
      const brandEmail = (venue as { brand_email?: string | null })?.brand_email?.trim();

      const html = `
<div style="font-family:'Open Sans',Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827">
${escapeHtml(rawBody)
  .split(/\n+/)
  .map((p) => `<p style="margin:0 0 12px">${p}</p>`)
  .join('')}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0" />
<p style="font-size:12px;color:#6b7280">Sent via StoryPay Conversations — reply to this email to continue the thread.</p>
</div>`;

      const result = await sendEmail({
        to,
        replyTo: brandEmail || undefined,
        subject: gate.thread.subject || 'Message from ' + venueName,
        html,
        from: { name: venueName, email: brandEmail || undefined },
      });

      external_email_sent = result.success;
      send_error = result.error ?? null;
      if (!result.success) {
        console.warn('[conversations] external email failed:', send_error);
      }
    }
  }

  const messageChannel =
    visibility === 'external' && replyChannel === 'sms' ? 'sms' : 'email';

  const { data: row, error: insErr } = await supabaseAdmin
    .from('conversation_messages')
    .insert({
      thread_id: threadId,
      visibility,
      channel: messageChannel,
      body: rawBody,
      sender_kind,
      venue_team_member_id,
      mentioned_member_ids: visibility === 'internal' ? mentionedIds : [],
      external_email_sent,
      send_error,
    })
    .select('*')
    .single();

  if (insErr || !row) {
    console.error('[conversations/messages POST]', insErr);
    return NextResponse.json({ error: insErr?.message ?? 'Failed to save message' }, { status: 500 });
  }

  const readerRef = conversationReaderRef(user);
  await supabaseAdmin.from('conversation_thread_reads').upsert(
    {
      thread_id: threadId,
      reader_ref: readerRef,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: 'thread_id,reader_ref' },
  );

  return NextResponse.json(row, { status: 201 });
}
