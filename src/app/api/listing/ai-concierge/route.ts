/**
 * GET /api/listing/ai-concierge
 *
 * Venue-scoped AI Concierge monitor. Returns every lead for the
 * signed-in venue that is in a non-dormant AI state, enriched with
 * last sent message, last reply, and most recent run outcome.
 *
 * This is a read-only view of the same data the super-admin monitor
 * shows, but restricted to the venue's own leads.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export async function GET(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url    = new URL(req.url);
  const stateQ = url.searchParams.get('state')?.trim() || null;
  const search = url.searchParams.get('search')?.trim().toLowerCase() || null;

  try {
    const validStates = ['ai_active', 'paused', 'handoff', 'exhausted', 'opted_out'];
    const targetStates = stateQ && validStates.includes(stateQ) ? [stateQ] : validStates;

    const { data: leadsRaw, error: leadsErr } = await supabaseAdmin
      .from('leads')
      .select('id, venue_id, first_name, last_name, name, email, phone, ai_state, ai_attempt_count, ai_next_send_at, ai_expires_at, ai_first_activated_at, ai_angles_used, last_inbound_at')
      .eq('venue_id', venueId)
      .in('ai_state', targetStates)
      .order('ai_next_send_at', { ascending: true, nullsFirst: false })
      .limit(200);

    if (leadsErr) throw new Error(leadsErr.message);

    type LeadRow = {
      id: string; venue_id: string;
      first_name: string | null; last_name: string | null; name: string | null;
      email: string | null; phone: string | null;
      ai_state: string; ai_attempt_count: number;
      ai_next_send_at: string | null; ai_expires_at: string | null;
      ai_first_activated_at: string | null; ai_angles_used: string[] | null;
      last_inbound_at: string | null;
    };
    const leads = (leadsRaw ?? []) as LeadRow[];

    if (leads.length === 0) {
      return NextResponse.json({
        leads: [],
        summary: { ai_active: 0, paused: 0, handoff: 0, exhausted: 0, opted_out: 0, expiringIn7d: 0 },
      });
    }

    const leadIds = leads.map(l => l.id);

    // Resolve venue_customers → threads → messages in parallel
    const [vcRes, runRes] = await Promise.all([
      supabaseAdmin
        .from('venue_customers')
        .select('id, customer_email')
        .eq('venue_id', venueId),
      supabaseAdmin
        .from('ai_runs')
        .select('lead_id, outcome, error_detail, created_at, final_sent_text')
        .in('lead_id', leadIds)
        .order('created_at', { ascending: false }),
    ]);

    const vcByEmail = new Map<string, string>();
    for (const vc of (vcRes.data ?? []) as Array<{ id: string; customer_email: string | null }>) {
      if (vc.customer_email) vcByEmail.set(vc.customer_email.toLowerCase(), vc.id);
    }

    const leadToVcId = new Map<string, string>();
    for (const l of leads) {
      const em = (l.email ?? '').trim().toLowerCase();
      const vcId = em ? vcByEmail.get(em) : undefined;
      if (vcId) leadToVcId.set(l.id, vcId);
    }

    const vcIds = Array.from(new Set(Array.from(leadToVcId.values())));
    let vcToThreadId = new Map<string, string>();
    if (vcIds.length > 0) {
      const { data: threadRows } = await supabaseAdmin
        .from('conversation_threads')
        .select('id, venue_customer_id')
        .in('venue_customer_id', vcIds)
        .eq('external_reply_channel', 'sms')
        .order('created_at', { ascending: false });
      for (const t of (threadRows ?? []) as Array<{ id: string; venue_customer_id: string }>) {
        if (!vcToThreadId.has(t.venue_customer_id)) vcToThreadId.set(t.venue_customer_id, t.id);
      }
    }

    const leadToThreadId = new Map<string, string>();
    for (const [leadId, vcId] of leadToVcId) {
      const tId = vcToThreadId.get(vcId);
      if (tId) leadToThreadId.set(leadId, tId);
    }

    const threadIds = Array.from(new Set(Array.from(leadToThreadId.values())));
    const lastSentByThread   = new Map<string, { body: string; created_at: string }>();
    const lastReplyByThread  = new Map<string, { body: string; created_at: string }>();

    if (threadIds.length > 0) {
      const [aiMsgsRes, replyMsgsRes] = await Promise.all([
        supabaseAdmin
          .from('conversation_messages')
          .select('thread_id, body, created_at')
          .in('thread_id', threadIds)
          .eq('sender_kind', 'ai')
          .order('created_at', { ascending: false }),
        supabaseAdmin
          .from('conversation_messages')
          .select('thread_id, body, created_at')
          .in('thread_id', threadIds)
          .eq('sender_kind', 'contact')
          .order('created_at', { ascending: false }),
      ]);
      for (const m of (aiMsgsRes.data ?? []) as Array<{ thread_id: string; body: string; created_at: string }>) {
        if (!lastSentByThread.has(m.thread_id)) lastSentByThread.set(m.thread_id, { body: m.body, created_at: m.created_at });
      }
      for (const m of (replyMsgsRes.data ?? []) as Array<{ thread_id: string; body: string; created_at: string }>) {
        if (!lastReplyByThread.has(m.thread_id)) lastReplyByThread.set(m.thread_id, { body: m.body, created_at: m.created_at });
      }
    }

    const lastRunByLead = new Map<string, { outcome: string; error: string | null; at: string; text: string | null }>();
    for (const r of (runRes.data ?? []) as Array<{ lead_id: string; outcome: string; error_detail: string | null; created_at: string; final_sent_text: string | null }>) {
      if (!lastRunByLead.has(r.lead_id)) lastRunByLead.set(r.lead_id, { outcome: r.outcome, error: r.error_detail, at: r.created_at, text: r.final_sent_text });
    }

    let result = leads.map(l => {
      const threadId = leadToThreadId.get(l.id) ?? null;
      const sent  = threadId ? lastSentByThread.get(threadId)  : null;
      const reply = threadId ? lastReplyByThread.get(threadId) : null;
      const run   = lastRunByLead.get(l.id);
      return {
        lead_id:               l.id,
        first_name:            (l.first_name ?? l.name?.split(' ')[0] ?? '').trim() || null,
        last_name:             (l.last_name ?? '').trim() || null,
        email:                 l.email ?? null,
        phone:                 l.phone ?? null,
        ai_state:              l.ai_state,
        ai_attempt_count:      l.ai_attempt_count ?? 0,
        ai_next_send_at:       l.ai_next_send_at,
        ai_expires_at:         l.ai_expires_at,
        ai_first_activated_at: l.ai_first_activated_at,
        ai_angles_used:        l.ai_angles_used ?? [],
        last_inbound_at:       l.last_inbound_at,
        last_sent_at:          sent?.created_at ?? null,
        last_sent_text:        sent?.body ?? run?.text ?? null,
        last_reply_at:         reply?.created_at ?? null,
        last_reply_body:       reply?.body ?? null,
        last_run_outcome:      run?.outcome ?? null,
        last_run_at:           run?.at ?? null,
        last_run_error:        run?.error ?? null,
      };
    });

    if (search) {
      result = result.filter(l =>
        (l.first_name ?? '').toLowerCase().includes(search) ||
        (l.last_name  ?? '').toLowerCase().includes(search) ||
        (l.email      ?? '').toLowerCase().includes(search),
      );
    }

    const now7d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const summary = {
      ai_active:    result.filter(l => l.ai_state === 'ai_active').length,
      paused:       result.filter(l => l.ai_state === 'paused').length,
      handoff:      result.filter(l => l.ai_state === 'handoff').length,
      exhausted:    result.filter(l => l.ai_state === 'exhausted').length,
      opted_out:    result.filter(l => l.ai_state === 'opted_out').length,
      expiringIn7d: result.filter(l => l.ai_state === 'ai_active' && l.ai_expires_at && l.ai_expires_at < now7d).length,
    };

    return NextResponse.json({ leads: result, summary });
  } catch (err) {
    console.error('[venue ai-monitor]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
