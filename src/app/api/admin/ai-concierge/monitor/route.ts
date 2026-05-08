/**
 * GET /api/admin/ai-concierge/monitor
 *
 * Returns every lead currently in a non-dormant AI state, enriched with
 * the last sent message, last bride reply, and most recent run outcome.
 * Designed to power the "Active Leads" monitor tab in the AI Concierge
 * admin panel — gives the concierge team full visibility into every
 * conversation the AI is running across all venues.
 *
 * Query params:
 *   venueId?  — filter to a single venue
 *   state?    — filter to a specific ai_state (default: all active)
 *   search?   — partial match on bride first/last/email or venue name
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

export interface MonitorLead {
  lead_id:                 string;
  venue_id:                string;
  venue_name:              string | null;
  persona_name:            string | null;
  first_name:              string | null;
  last_name:               string | null;
  email:                   string | null;
  phone:                   string | null;
  ai_state:                string;
  ai_attempt_count:        number;
  ai_next_send_at:         string | null;
  ai_expires_at:           string | null;
  ai_first_activated_at:   string | null;
  ai_angles_used:          string[];
  last_inbound_at:         string | null;
  // Last outbound AI message (from conversation_messages)
  last_sent_at:            string | null;
  last_sent_text:          string | null;
  // Last bride reply body
  last_reply_at:           string | null;
  last_reply_body:         string | null;
  // Most recent ai_run outcome
  last_run_outcome:        string | null;
  last_run_at:             string | null;
  last_run_error:          string | null;
}

export interface MonitorPayload {
  leads:   MonitorLead[];
  summary: {
    ai_active:   number;
    paused:      number;
    handoff:     number;
    exhausted:   number;
    opted_out:   number;
    expiringIn7d: number;  // ai_active leads expiring in <=7 days
  };
}

export async function GET(req: NextRequest) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url      = new URL(req.url);
  const venueId  = url.searchParams.get('venueId')?.trim()  || null;
  const stateQ   = url.searchParams.get('state')?.trim()    || null;
  const search   = url.searchParams.get('search')?.trim().toLowerCase() || null;

  try {
    // ── 1. Fetch all non-dormant leads ──────────────────────────────────────
    // Include opted_out/exhausted from last 14 days so the panel shows
    // recently-concluded conversations too.
    const validStates = ['ai_active', 'paused', 'handoff', 'exhausted', 'opted_out'];
    const targetStates = stateQ && validStates.includes(stateQ) ? [stateQ] : validStates;

    let leadsQuery = supabaseAdmin
      .from('leads')
      .select('id, venue_id, first_name, last_name, name, email, phone, ai_state, ai_attempt_count, ai_next_send_at, ai_expires_at, ai_first_activated_at, ai_angles_used, last_inbound_at')
      .in('ai_state', targetStates)
      .order('ai_next_send_at', { ascending: true, nullsFirst: false })
      .limit(300);

    if (venueId) leadsQuery = leadsQuery.eq('venue_id', venueId);

    // For terminal states (exhausted/opted_out), only show those updated in the last 14 days
    // We approximate this by ai_first_activated_at being recent — not perfect but avoids
    // stale rows piling up. A future migration could add ai_state_changed_at.
    const { data: leadsRaw, error: leadsErr } = await leadsQuery;
    if (leadsErr) throw new Error(`leads query: ${leadsErr.message}`);

    let leads = (leadsRaw ?? []) as Array<{
      id: string; venue_id: string;
      first_name: string | null; last_name: string | null; name: string | null;
      email: string | null; phone: string | null;
      ai_state: string; ai_attempt_count: number;
      ai_next_send_at: string | null; ai_expires_at: string | null;
      ai_first_activated_at: string | null; ai_angles_used: string[] | null;
      last_inbound_at: string | null;
    }>;

    if (leads.length === 0) {
      return NextResponse.json({
        leads: [],
        summary: { ai_active: 0, paused: 0, handoff: 0, exhausted: 0, opted_out: 0, expiringIn7d: 0 },
      } satisfies MonitorPayload);
    }

    const leadIds  = leads.map(l => l.id);
    const venueIds = Array.from(new Set(leads.map(l => l.venue_id)));

    // ── 2. Venue names + persona names ──────────────────────────────────────
    const { data: venueRows } = await supabaseAdmin
      .from('venues')
      .select('id, name, ai_assistant_persona_name')
      .in('id', venueIds);

    const venueById = new Map<string, { name: string | null; persona: string | null }>();
    for (const v of (venueRows ?? []) as Array<{ id: string; name: string | null; ai_assistant_persona_name: string | null }>) {
      venueById.set(v.id, { name: v.name, persona: v.ai_assistant_persona_name });
    }

    // ── 3. Last AI-sent message per lead (from conversation_messages) ────────
    const { data: sentMsgs } = await supabaseAdmin
      .from('conversation_messages')
      .select('thread_id, body, created_at')
      .eq('sender_kind', 'ai')
      .eq('visibility', 'external')
      .order('created_at', { ascending: false });

    // We need thread→lead mapping; get threads for these customers
    // Simpler: look up via ai_runs which already has lead_id
    // We'll join through ai_runs last run below.

    // ── 4. Last bride reply per lead (conversation_messages sender_kind=contact) ──
    // For each lead, we need to find their thread. Use last_inbound_at + conversation_messages.
    // Efficient: bulk query thread_ids for these leads via venue_customers → threads
    const { data: vcRows } = await supabaseAdmin
      .from('venue_customers')
      .select('id, venue_id, customer_email')
      .in('venue_id', venueIds);

    // Build email→vcId map per venue
    const vcByVenueEmail = new Map<string, string>();
    for (const vc of (vcRows ?? []) as Array<{ id: string; venue_id: string; customer_email: string | null }>) {
      if (vc.customer_email) {
        vcByVenueEmail.set(`${vc.venue_id}:${vc.customer_email.toLowerCase()}`, vc.id);
      }
    }

    // Map lead→venueCustomerId
    const leadToVcId = new Map<string, string>();
    for (const l of leads) {
      const em = (l.email ?? '').trim().toLowerCase();
      if (!em) continue;
      const vcId = vcByVenueEmail.get(`${l.venue_id}:${em}`);
      if (vcId) leadToVcId.set(l.id, vcId);
    }

    const vcIds = Array.from(new Set(Array.from(leadToVcId.values())));
    const vcToThreadId = new Map<string, string>();
    const { data: threadRows } = vcIds.length > 0
      ? await supabaseAdmin
          .from('conversation_threads')
          .select('id, venue_customer_id')
          .in('venue_customer_id', vcIds)
          .eq('external_reply_channel', 'sms')
          .order('created_at', { ascending: false })
      : { data: [] };

    for (const t of (threadRows ?? []) as Array<{ id: string; venue_customer_id: string }>) {
      if (!vcToThreadId.has(t.venue_customer_id)) {
        vcToThreadId.set(t.venue_customer_id, t.id);
      }
    }

    const leadToThreadId = new Map<string, string>();
    for (const [leadId, vcId] of leadToVcId) {
      const tId = vcToThreadId.get(vcId);
      if (tId) leadToThreadId.set(leadId, tId);
    }

    const threadIds = Array.from(new Set(Array.from(leadToThreadId.values())));

    // Last AI-sent message per thread
    const lastSentByThread = new Map<string, { body: string; created_at: string }>();
    if (threadIds.length > 0) {
      const { data: aiMsgs } = await supabaseAdmin
        .from('conversation_messages')
        .select('thread_id, body, created_at')
        .in('thread_id', threadIds)
        .eq('sender_kind', 'ai')
        .order('created_at', { ascending: false });
      for (const m of (aiMsgs ?? []) as Array<{ thread_id: string; body: string; created_at: string }>) {
        if (!lastSentByThread.has(m.thread_id)) {
          lastSentByThread.set(m.thread_id, { body: m.body, created_at: m.created_at });
        }
      }
    }

    // Last bride reply per thread
    const lastReplyByThread = new Map<string, { body: string; created_at: string }>();
    if (threadIds.length > 0) {
      const { data: replyMsgs } = await supabaseAdmin
        .from('conversation_messages')
        .select('thread_id, body, created_at')
        .in('thread_id', threadIds)
        .eq('sender_kind', 'contact')
        .order('created_at', { ascending: false });
      for (const m of (replyMsgs ?? []) as Array<{ thread_id: string; body: string; created_at: string }>) {
        if (!lastReplyByThread.has(m.thread_id)) {
          lastReplyByThread.set(m.thread_id, { body: m.body, created_at: m.created_at });
        }
      }
    }

    // ── 5. Last ai_run per lead ──────────────────────────────────────────────
    const { data: runRows } = await supabaseAdmin
      .from('ai_runs')
      .select('lead_id, outcome, error_detail, created_at, final_sent_text')
      .in('lead_id', leadIds)
      .order('created_at', { ascending: false });

    const lastRunByLead = new Map<string, { outcome: string; error: string | null; at: string; text: string | null }>();
    for (const r of (runRows ?? []) as Array<{ lead_id: string; outcome: string; error_detail: string | null; created_at: string; final_sent_text: string | null }>) {
      if (!lastRunByLead.has(r.lead_id)) {
        lastRunByLead.set(r.lead_id, { outcome: r.outcome, error: r.error_detail, at: r.created_at, text: r.final_sent_text });
      }
    }

    // ── 6. Assemble + apply search filter ────────────────────────────────────
    void sentMsgs; // fetched through threads path above; suppress unused warning

    let result: MonitorLead[] = leads.map(l => {
      const venue   = venueById.get(l.venue_id);
      const threadId = leadToThreadId.get(l.id) ?? null;
      const sent    = threadId ? lastSentByThread.get(threadId) : null;
      const reply   = threadId ? lastReplyByThread.get(threadId) : null;
      const run     = lastRunByLead.get(l.id);
      const fn      = (l.first_name ?? l.name?.split(' ')[0] ?? '').trim();
      return {
        lead_id:               l.id,
        venue_id:              l.venue_id,
        venue_name:            venue?.name ?? null,
        persona_name:          venue?.persona ?? null,
        first_name:            fn || null,
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
        (l.first_name  ?? '').toLowerCase().includes(search) ||
        (l.last_name   ?? '').toLowerCase().includes(search) ||
        (l.email       ?? '').toLowerCase().includes(search) ||
        (l.venue_name  ?? '').toLowerCase().includes(search),
      );
    }

    // ── 7. Summary counts ────────────────────────────────────────────────────
    const now7d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const summary = {
      ai_active:    result.filter(l => l.ai_state === 'ai_active').length,
      paused:       result.filter(l => l.ai_state === 'paused').length,
      handoff:      result.filter(l => l.ai_state === 'handoff').length,
      exhausted:    result.filter(l => l.ai_state === 'exhausted').length,
      opted_out:    result.filter(l => l.ai_state === 'opted_out').length,
      expiringIn7d: result.filter(l =>
        l.ai_state === 'ai_active' && l.ai_expires_at && l.ai_expires_at < now7d
      ).length,
    };

    return NextResponse.json({ leads: result, summary } satisfies MonitorPayload);
  } catch (err) {
    console.error('[ai-monitor]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
