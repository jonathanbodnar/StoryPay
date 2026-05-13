import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { getSessionUser } from '@/lib/session';
import { sendEmail } from '@/lib/email';
import { conversationReaderRef } from '@/lib/conversation-reader';
import { findOrCreateContact, normalizePhone, sendSms } from '@/lib/ghl';
import { ensureLocationToken } from '@/lib/ghl-auth';
import { buildConversationsReplyToEmail } from '@/lib/conversations-inbound-email';
import { syncInboundSmsFromGhlForThread } from '@/lib/ghl-sms-conversations';
import { broadcastBrideMessage } from '@/lib/realtime/broadcast';

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

function parseEmailRecipientsField(v: unknown): string[] {
  if (typeof v !== 'string' || !v.trim()) return [];
  return v
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
}

function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io').replace(/\/$/, '');
}

type ResolvedOutboundTrigger = {
  short_code: string;
  name: string | null;
  href: string;
  displayText: string;
};

async function resolveTriggerForOutbound(
  venueId: string,
  triggerLinkId: string,
  leadEmailForTracking: string | null,
): Promise<{ ok: true; trigger: ResolvedOutboundTrigger } | { ok: false; response: NextResponse }> {
  const { data: tl, error: tlErr } = await supabaseAdmin
    .from('trigger_links')
    .select('id, short_code, name')
    .eq('id', triggerLinkId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (tlErr || !tl) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid trigger link for this venue.' }, { status: 400 }),
    };
  }
  const shortCode = String(tl.short_code);
  const em = leadEmailForTracking?.trim() || null;
  let token: string | undefined;
  if (em) {
    const { data: leadRow } = await supabaseAdmin
      .from('leads')
      .select('track_token')
      .eq('venue_id', venueId)
      .ilike('email', em)
      .maybeSingle();
    token = (leadRow as { track_token?: string } | null)?.track_token?.trim().toLowerCase();
  }
  const base = appOrigin();
  const q = token && /^[0-9a-f]{32}$/i.test(token) ? `?t=${encodeURIComponent(token)}` : '';
  const href = `${base}/t/${encodeURIComponent(shortCode)}${q}`;
  let displayHost: string;
  try {
    displayHost = new URL(base).hostname;
  } catch {
    displayHost = 'storypay.io';
  }
  const displayText = `${displayHost}/t/${shortCode}`;
  return {
    ok: true,
    trigger: {
      short_code: shortCode,
      name: (tl.name as string) || null,
      href,
      displayText,
    },
  };
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
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { threadId } = await params;
  const gate = await assertThreadVenue(threadId, venueId);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.error === 'Not found' ? 404 : 500 });

  const thread = gate.thread as {
    external_reply_channel?: string;
    venue_customer_id: string;
  };
  // Skip the GHL poll-sync for lightweight background refreshes (?nosync=1).
  // The full sync runs on initial thread open and explicit user-triggered reloads.
  const nosync = request.nextUrl.searchParams.get('nosync') === '1';
  if (!nosync && thread.external_reply_channel === 'sms') {
    await syncInboundSmsFromGhlForThread({
      venueId,
      threadId,
      venueCustomerId: thread.venue_customer_id,
    });
  }

  // Hide ONLY support-team-only internal notes (concierge scratchpad).
  // Both `external` (bride-facing) and `venue_direct` (concierge↔venue
  // private side-channel) messages are visible to the venue here. The UI
  // styles venue_direct distinctly so it can't be confused with bride
  // messages.
  const { data: messages, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('*')
    .eq('thread_id', threadId)
    .eq('support_only', false)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tlIds = [
    ...new Set(
      (messages ?? [])
        .map((m) => m.trigger_link_id as string | null | undefined)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
  const triggerById: Record<string, { short_code: string; name: string | null }> = {};
  if (tlIds.length > 0) {
    const { data: links } = await supabaseAdmin
      .from('trigger_links')
      .select('id, short_code, name')
      .eq('venue_id', venueId)
      .in('id', tlIds);
    for (const L of links ?? []) {
      const row = L as { id: string; short_code: string; name: string | null };
      triggerById[row.id] = { short_code: row.short_code, name: row.name };
    }
  }

  const memberIds = new Set<string>();
  const supportIds = new Set<string>();
  for (const m of messages ?? []) {
    if (m.venue_team_member_id) memberIds.add(m.venue_team_member_id as string);
    if (m.sent_by_support_user_id) supportIds.add(m.sent_by_support_user_id as string);
  }
  const memberNames: Record<string, string> = {};
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
  const supportNames: Record<string, string> = {};
  if (supportIds.size > 0) {
    const { data: supportRows } = await supabaseAdmin
      .from('support_team_members')
      .select('id, name')
      .in('id', [...supportIds]);
    for (const s of supportRows ?? []) {
      const r = s as { id: string; name: string };
      supportNames[r.id] = r.name || 'StoryVenue Support';
    }
  }

  const enriched = (messages ?? []).map((m) => {
    const tid = m.trigger_link_id as string | null | undefined;
    const tmeta = tid ? triggerById[tid] : undefined;
    const supportId = m.sent_by_support_user_id as string | null | undefined;
    const supportAgentName = supportId ? supportNames[supportId] || null : null;
    return {
      ...m,
      trigger_link: tmeta
        ? { short_code: tmeta.short_code, name: tmeta.name }
        : null,
      support_agent_name: supportAgentName,
      author_label:
        m.sender_kind === 'concierge'
          ? supportAgentName
            ? `StoryVenue Support — ${supportAgentName}`
            : 'StoryVenue Support'
          : m.sender_kind === 'ai'
            ? 'AI Concierge'
          : m.sender_kind === 'owner'
            ? 'Owner'
          : m.sender_kind === 'contact'
            ? (m.contact_from_name as string) || 'Contact'
          : m.sender_kind === 'system'
            ? 'System'
          : memberNames[m.venue_team_member_id as string] || 'Team member',
    };
  });

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
  const rawSubject =
    typeof body.email_subject === 'string' ? body.email_subject.trim() : '';
  const externalChannelOverride = body.external_channel as string | undefined;
  const emailCcList = parseEmailRecipientsField(body.email_cc);
  const emailBccList = parseEmailRecipientsField(body.email_bcc);
  const emailCcStored = emailCcList.length ? emailCcList.join(', ') : null;
  const emailBccStored = emailBccList.length ? emailBccList.join(', ') : null;
  const triggerLinkId =
    typeof body.trigger_link_id === 'string' && /^[\da-f-]{36}$/i.test(body.trigger_link_id)
      ? body.trigger_link_id
      : null;
  const mentionedIds = Array.isArray(body.mentioned_member_ids)
    ? (body.mentioned_member_ids as string[]).filter((id) => typeof id === 'string')
    : [];

  if (visibility !== 'internal' && visibility !== 'external') {
    return NextResponse.json({ error: 'visibility must be internal or external' }, { status: 400 });
  }
  if (visibility === 'internal' && !rawBody) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 });
  }
  if (visibility === 'external' && !rawBody && !triggerLinkId) {
    return NextResponse.json(
      { error: 'Add a message or choose a trigger link to send.' },
      { status: 400 },
    );
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
  /** Actual address we attempted delivery to (email for email channel, E.164 phone for SMS). */
  let recipient_address: string | null = null;

  const threadReplyChannel =
    (gate.thread as { external_reply_channel?: string }).external_reply_channel ?? 'email';
  const replyChannel =
    externalChannelOverride === 'sms' || externalChannelOverride === 'email'
      ? externalChannelOverride
      : threadReplyChannel;

  if (triggerLinkId && visibility !== 'external') {
    return NextResponse.json(
      { error: 'Trigger links can only be attached to client-visible messages.' },
      { status: 400 },
    );
  }
  if (triggerLinkId && replyChannel !== 'email' && replyChannel !== 'sms') {
    return NextResponse.json({ error: 'Invalid channel for trigger link.' }, { status: 400 });
  }

  const venueCustomerId = (gate.thread as { venue_customer_id: string }).venue_customer_id;

  if (visibility === 'external') {
    const { data: dndRow } = await supabaseAdmin
      .from('venue_customers')
      .select('sms_dnd, conversation_dnd_all, conversation_dnd_email')
      .eq('id', venueCustomerId)
      .eq('venue_id', venueId)
      .maybeSingle();
    const dnd = dndRow as {
      sms_dnd?: boolean;
      conversation_dnd_all?: boolean;
      conversation_dnd_email?: boolean;
    } | null;
    if (dnd?.conversation_dnd_all) {
      return NextResponse.json(
        { error: 'This contact has Do Not Disturb (all channels) enabled.' },
        { status: 400 },
      );
    }
    if (replyChannel === 'email' && dnd?.conversation_dnd_email) {
      return NextResponse.json(
        { error: 'This contact has email Do Not Disturb enabled.' },
        { status: 400 },
      );
    }
    if (replyChannel === 'sms' && dnd?.sms_dnd) {
      return NextResponse.json(
        { error: 'This contact has SMS Do Not Disturb enabled (e.g. they texted STOP).' },
        { status: 400 },
      );
    }
  }

  if (visibility === 'external') {
    if (replyChannel === 'sms') {
      const { data: contact } = await supabaseAdmin
        .from('venue_customers')
        .select('customer_email, first_name, last_name, phone, ghl_contact_id')
        .eq('id', venueCustomerId)
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
              'Connect Legacy messaging for this venue (Settings → Integrations) to send SMS from Conversations.',
          },
          { status: 400 },
        );
      }

      let ghlToken: string;
      try {
        ghlToken = await ensureLocationToken({
          id: venueId,
          ghl_location_id: vrow.ghl_location_id as string,
          ghl_access_token: (vrow as { ghl_access_token?: string | null }).ghl_access_token ?? null,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Legacy messaging credentials are not configured for this venue.';
        return NextResponse.json({ error: msg }, { status: 400 });
      }

      const phoneE164 = normalizePhone((contact as { phone?: string | null } | null)?.phone ?? null);
      if (!phoneE164) {
        return NextResponse.json(
          { error: 'This contact needs a phone number on their profile to send SMS.' },
          { status: 400 },
        );
      }
      recipient_address = phoneE164;

      const email = ((contact as { customer_email?: string } | null)?.customer_email ?? '').trim();
      const firstName = (contact as { first_name?: string } | null)?.first_name ?? '';
      const lastName = (contact as { last_name?: string } | null)?.last_name ?? '';
      let contactId = (contact as { ghl_contact_id?: string | null } | null)?.ghl_contact_id ?? null;

      try {
        if (!contactId) {
          contactId = await findOrCreateContact(ghlToken, vrow.ghl_location_id as string, {
            email: email || `ghl.${venueCustomerId}@${PLACEHOLDER_SMS_EMAIL_DOMAIN}`,
            phone: phoneE164,
            firstName,
            lastName,
          });
          await supabaseAdmin
            .from('venue_customers')
            .update({ ghl_contact_id: contactId })
            .eq('id', venueCustomerId)
            .eq('venue_id', venueId);
        }
        if (!contactId) {
          throw new Error('Could not resolve Legacy messaging contact for this phone number.');
        }
        let smsBody = rawBody;
        if (triggerLinkId) {
          const resolved = await resolveTriggerForOutbound(venueId, triggerLinkId, email || null);
          if (!resolved.ok) return resolved.response;
          const { trigger: t } = resolved;
          const linkLine = `${t.displayText}\n${t.href}`;
          smsBody = rawBody.trim() ? `${rawBody.trim()}\n\n${linkLine}` : linkLine;
        }
        await sendSms(
          ghlToken,
          vrow.ghl_location_id as string,
          contactId,
          smsBody,
          undefined,
          phoneE164,
        );
        external_email_sent = true;
      } catch (e) {
        send_error = e instanceof Error ? e.message : 'SMS send failed';
        console.warn('[conversations] external SMS failed:', send_error);
      }
    } else {
      const { data: contact } = await supabaseAdmin
        .from('venue_customers')
        .select('customer_email, first_name, last_name')
        .eq('id', venueCustomerId)
        .eq('venue_id', venueId)
        .maybeSingle();

      const to = (contact as { customer_email?: string } | null)?.customer_email?.trim();
      if (!to) {
        return NextResponse.json({ error: 'Contact has no email — add one on their profile first.' }, { status: 400 });
      }
      // The GHL sync generates `ghl.{id}@ghl-import.storyvenue.placeholder`
      // addresses for contacts that had no email in GHL. They look real (Resend
      // accepts them) but the domain doesn't resolve so the email goes nowhere.
      // Refuse to send rather than silently dropping the message into the void.
      if (/@ghl-import\.storyvenue\.placeholder$/i.test(to)) {
        return NextResponse.json(
          {
            error:
              'This contact only has a placeholder email from GoHighLevel sync (no real email on file). Open their profile and add a real email address before sending.',
          },
          { status: 400 },
        );
      }
      recipient_address = to;

      const { data: venue } = await supabaseAdmin
        .from('venues')
        .select('name, brand_email')
        .eq('id', venueId)
        .single();

      const venueName = (venue as { name?: string })?.name ?? 'Venue';
      const brandEmail = (venue as { brand_email?: string | null })?.brand_email?.trim();

      let resolvedTrigger: ResolvedOutboundTrigger | null = null;
      if (triggerLinkId) {
        const resolved = await resolveTriggerForOutbound(venueId, triggerLinkId, to);
        if (!resolved.ok) return resolved.response;
        resolvedTrigger = resolved.trigger;
      }

      const triggerBlock = resolvedTrigger
        ? `<p style="margin:16px 0 12px"><a href="${escapeHtml(resolvedTrigger.href)}" style="color:#111827;font-weight:600;text-decoration:underline">${escapeHtml(resolvedTrigger.displayText)}</a>${
            resolvedTrigger.name
              ? `<span style="color:#6b7280;font-size:13px"> — ${escapeHtml(resolvedTrigger.name)}</span>`
              : ''
          }</p>`
        : '';

      const html = `
<div style="font-family:'Open Sans',Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827">
${escapeHtml(rawBody)
  .split(/\n+/)
  .map((p) => `<p style="margin:0 0 12px">${p}</p>`)
  .join('')}
${triggerBlock}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0" />
<p style="font-size:12px;color:#6b7280">Sent via StoryVenue Conversations — reply to this email to continue the thread.</p>
</div>`;

      const subjectLine =
        rawSubject ||
        String((gate.thread as { subject?: string }).subject || '').trim() ||
        'Message from ' + venueName;

      const replyRouting = buildConversationsReplyToEmail(threadId, venueId);
      const result = await sendEmail({
        to,
        cc: emailCcList.length ? emailCcList : undefined,
        bcc: emailBccList.length ? emailBccList : undefined,
        replyTo: replyRouting || brandEmail || undefined,
        subject: subjectLine,
        html,
        from: { name: venueName, email: brandEmail || undefined },
      });

      external_email_sent = result.success;
      send_error = result.error ?? null;
      if (!result.success) {
        console.warn('[conversations] external email failed:', send_error);
      } else if (rawSubject) {
        await supabaseAdmin
          .from('conversation_threads')
          .update({ subject: rawSubject, updated_at: new Date().toISOString() })
          .eq('id', threadId)
          .eq('venue_id', venueId);
      }
    }
  }

  const messageChannel =
    visibility === 'external' && replyChannel === 'sms' ? 'sms' : 'email';

  const insertTriggerId =
    visibility === 'external' && (messageChannel === 'email' || messageChannel === 'sms') && triggerLinkId
      ? triggerLinkId
      : null;

  /** Only set keys for columns that exist in the DB. Migration 043 adds email_cc, email_bcc, trigger_link_id. */
  const insertRow: Record<string, unknown> = {
    thread_id: threadId,
    visibility,
    channel: messageChannel,
    body: rawBody,
    sender_kind,
    venue_team_member_id,
    mentioned_member_ids: visibility === 'internal' ? mentionedIds : [],
    external_email_sent,
    send_error,
  };
  if (visibility === 'external' && messageChannel === 'email') {
    insertRow.email_subject = rawSubject || null;
    if (emailCcStored) insertRow.email_cc = emailCcStored;
    if (emailBccStored) insertRow.email_bcc = emailBccStored;
  }
  // Persist the actual recipient address for both email and SMS so the UI can
  // show "Sent to: ..." with confidence (independent of venue_customers state).
  if (visibility === 'external' && recipient_address) {
    insertRow.email_to = recipient_address;
  }
  if (insertTriggerId) {
    insertRow.trigger_link_id = insertTriggerId;
  }

  let { data: row, error: insErr } = await supabaseAdmin
    .from('conversation_messages')
    .insert(insertRow)
    .select('*')
    .single();

  // Backwards-compat: if migration 136 (email_to column) hasn't been applied,
  // retry the insert without it so message sending still works.
  if (insErr && /email_to/i.test(insErr.message ?? '') && 'email_to' in insertRow) {
    delete insertRow.email_to;
    const retry = await supabaseAdmin
      .from('conversation_messages')
      .insert(insertRow)
      .select('*')
      .single();
    row = retry.data;
    insErr = retry.error;
  }

  if (insErr || !row) {
    console.error('[conversations/messages POST]', insErr);
    return NextResponse.json({ error: insErr?.message ?? 'Failed to save message' }, { status: 500 });
  }

  // Keep the thread's external_reply_channel in sync with what was actually sent
  // so the chat list badge reflects the correct channel (SMS vs Email).
  if (visibility === 'external' && (replyChannel === 'sms' || replyChannel === 'email')) {
    const currentChannel = (gate.thread as { external_reply_channel?: string }).external_reply_channel ?? 'email';
    if (currentChannel !== replyChannel) {
      await supabaseAdmin
        .from('conversation_threads')
        .update({ external_reply_channel: replyChannel })
        .eq('id', threadId)
        .eq('venue_id', venueId);
    }
  }

  // Mark the sender as having read this thread.
  const readerRef = conversationReaderRef(user);
  await supabaseAdmin.from('conversation_thread_reads').upsert(
    {
      thread_id: threadId,
      reader_ref: readerRef,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: 'thread_id,reader_ref' },
  );

  // For team notes with @mentions, delete the mentioned members' read receipts
  // so the thread shows as unread for them until they open it.
  if (visibility === 'internal' && mentionedIds.length > 0) {
    const mentionedRefs = mentionedIds.map((id) => `m:${id}`);
    await supabaseAdmin
      .from('conversation_thread_reads')
      .delete()
      .eq('thread_id', threadId)
      .in('reader_ref', mentionedRefs);
  }

  // Broadcast outbound external messages so the admin support inbox can
  // remove this thread from "needs attention" and any open thread view
  // (admin or venue) can append the new bubble live. Internal team notes
  // skip the broadcast — they shouldn't surface in the support UI.
  if (visibility === 'external') {
    void broadcastBrideMessage({
      inbound:            false,
      threadId,
      venueId,
      venueCustomerId,
      messageId:          (row as { id: string }).id,
      body:               rawBody,
      channel:            messageChannel as 'sms' | 'email',
      senderKind:         sender_kind,
      sentByVenueSupport: false,
      supportAgentId:     null,
      createdAt:          (row as { created_at?: string }).created_at || new Date().toISOString(),
    });
  }

  return NextResponse.json(row, { status: 201 });
}
