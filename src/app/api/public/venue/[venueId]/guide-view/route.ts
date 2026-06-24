/**
 * POST /api/public/venue/[venueId]/guide-view
 *
 * Called client-side from the public guide preview page when a bride opens
 * the link.  Logs a "Guide viewed" system message in the contact's
 * conversation thread so there's a full audit trail:
 *
 *   Guide sent  (logged by sendBookingSystemGuide)
 *   Guide viewed (logged here)
 *   Bride replies via email/SMS (logged by inbound webhook handlers)
 *
 * Body: { leadId: string }
 * No authentication — venueId is public, leadId is a UUID sent in the URL
 * that a bride already has access to (they received the personalized link).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    if (!venueId) return NextResponse.json({ ok: false }, { status: 400 });

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const leadId = typeof body.leadId === 'string' ? body.leadId.trim() : '';
    if (!leadId) return NextResponse.json({ ok: false }, { status: 400 });

    // Validate the lead belongs to this venue
    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('id, email, first_name, last_name, name')
      .eq('id', leadId)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (!lead) return NextResponse.json({ ok: false }, { status: 404 });

    const email = String(lead.email || '').trim().toLowerCase();
    if (!email) return NextResponse.json({ ok: true }); // no thread to log to

    // Find the email conversation thread for this contact
    const { data: vc } = await supabaseAdmin
      .from('venue_customers')
      .select('id')
      .eq('venue_id', venueId)
      .ilike('customer_email', email)
      .maybeSingle();
    if (!vc) return NextResponse.json({ ok: true }); // thread not created yet

    const { data: thread } = await supabaseAdmin
      .from('conversation_threads')
      .select('id')
      .eq('venue_id', venueId)
      .eq('venue_customer_id', (vc as { id: string }).id)
      .eq('external_reply_channel', 'email')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!thread) return NextResponse.json({ ok: true });

    const threadId = (thread as { id: string }).id;
    const fn = (lead.first_name as string | null)?.trim() || (lead.name as string | null)?.split(/\s+/)[0] || 'The bride';

    // Deduplicate: don't log if we already logged a view in the last 10 min
    // (prevents re-renders / bot crawls from polluting the thread)
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: recentView } = await supabaseAdmin
      .from('conversation_messages')
      .select('id')
      .eq('thread_id', threadId)
      .eq('sender_kind', 'system')
      .ilike('body', '%Guide viewed%')
      .gt('created_at', tenMinAgo)
      .limit(1)
      .maybeSingle();
    if (recentView) return NextResponse.json({ ok: true }); // already logged recently

    // This is an internal tracking note (the bride opened the guide), not an
    // outbound email. Logging it as 'internal' keeps it out of the email-send
    // path so it never renders a misleading "failed to send" status.
    await supabaseAdmin.from('conversation_messages').insert({
      thread_id:            threadId,
      visibility:           'internal',
      channel:              'email',
      body:                 `👁 Guide viewed — ${fn} opened the pricing guide preview.`,
      sender_kind:          'system',
    });

    // Update thread preview
    await supabaseAdmin
      .from('conversation_threads')
      .update({
        last_message_preview: `${fn} viewed the pricing guide`,
        last_message_at:      new Date().toISOString(),
      })
      .eq('id', threadId)
      .eq('venue_id', venueId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[guide-view]', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
