/**
 * GET /api/cron/tag-sweep
 *
 * Nightly cron that auto-applies date-based and activity-based system tags
 * to leads across all active venues. Safe to run more than once — all
 * tag applications are idempotent.
 *
 * Tags maintained:
 *   within_30_days   — wedding_date is between today and +30 days
 *   within_7_days    — wedding_date is between today and +7 days
 *   event_passed     — wedding_date is in the past
 *   anniversary_year_1 — wedding_date was exactly 1 year ago (±3 day window)
 *   inactive         — no activity for 45+ days (no last_inbound_at or updated_at)
 *   cold_lead        — no activity for 30+ days
 *   balance_due      — open (unpaid/partial) proposal exists
 *   past_due         — overdue proposal (signed but unpaid, >7 days old)
 *   re_engaged       — had cold_lead/inactive tag but replied in last 24 h
 *
 * Add to Railway/Vercel cron schedule: every day at 3:00 AM UTC
 *   0 3 * * *  GET /api/cron/tag-sweep?secret=<CRON_SECRET>
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { applySystemTag, removeSystemTag, ensureSystemTagsForVenue, applySystemTags } from '@/lib/system-tags';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET ?? process.env.MARKETING_CRON_SECRET ?? '';

function authOk(req: NextRequest): boolean {
  if (!CRON_SECRET) return true;
  const bearer = req.headers.get('authorization')?.replace('Bearer ', '').trim();
  const qs = req.nextUrl.searchParams.get('secret')?.trim();
  return bearer === CRON_SECRET || qs === CRON_SECRET;
}

interface TagSweepCounts {
  within_30_days: number;
  within_7_days: number;
  event_passed: number;
  anniversary_year_1: number;
  inactive: number;
  cold_lead: number;
  balance_due: number;
  past_due: number;
  re_engaged: number;
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const counts: TagSweepCounts = {
    within_30_days: 0,
    within_7_days: 0,
    event_passed: 0,
    anniversary_year_1: 0,
    inactive: 0,
    cold_lead: 0,
    balance_due: 0,
    past_due: 0,
    re_engaged: 0,
  };

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  // Date thresholds
  const in7Days  = new Date(now); in7Days.setDate(in7Days.getDate() + 7);
  const in30Days = new Date(now); in30Days.setDate(in30Days.getDate() + 30);
  const ago30    = new Date(now); ago30.setDate(ago30.getDate() - 30);
  const ago45    = new Date(now); ago45.setDate(ago45.getDate() - 45);
  const ago24h   = new Date(now); ago24h.setHours(ago24h.getHours() - 24);

  // Anniversary window: wedding_date between 362 and 368 days ago
  const annivFrom = new Date(now); annivFrom.setDate(annivFrom.getDate() - 368);
  const annivTo   = new Date(now); annivTo.setDate(annivTo.getDate() - 362);

  // 1. ── Date-based: within_30_days, within_7_days, event_passed ─────────────
  {
    const { data: dateLeads } = await supabaseAdmin
      .from('leads')
      .select('id, venue_id, wedding_date')
      .not('wedding_date', 'is', null)
      .gte('wedding_date', annivFrom.toISOString().slice(0, 10)) // don't go too far back
      .order('wedding_date', { ascending: true })
      .limit(5000);

    const venuesSeen = new Set<string>();
    for (const lead of (dateLeads ?? []) as { id: string; venue_id: string; wedding_date: string }[]) {
      if (!venuesSeen.has(lead.venue_id)) {
        await ensureSystemTagsForVenue(lead.venue_id).catch(() => {});
        venuesSeen.add(lead.venue_id);
      }

      const wDate = lead.wedding_date.slice(0, 10);

      if (wDate < todayStr) {
        // Event has passed
        applySystemTag(lead.venue_id, lead.id, 'event_passed').catch(() => {});
        removeSystemTag(lead.venue_id, lead.id, 'within_30_days').catch(() => {});
        removeSystemTag(lead.venue_id, lead.id, 'within_7_days').catch(() => {});
        counts.event_passed++;
      } else if (wDate <= in7Days.toISOString().slice(0, 10)) {
        // Within 7 days (also within 30 days)
        applySystemTag(lead.venue_id, lead.id, 'within_7_days').catch(() => {});
        applySystemTag(lead.venue_id, lead.id, 'within_30_days').catch(() => {});
        counts.within_7_days++;
        counts.within_30_days++;
      } else if (wDate <= in30Days.toISOString().slice(0, 10)) {
        // Within 30 days (but not within 7)
        applySystemTag(lead.venue_id, lead.id, 'within_30_days').catch(() => {});
        removeSystemTag(lead.venue_id, lead.id, 'within_7_days').catch(() => {});
        counts.within_30_days++;
      }
    }
  }

  // 2. ── Anniversary: wedding_date ~1 year ago ────────────────────────────────
  {
    const { data: anniversaryLeads } = await supabaseAdmin
      .from('leads')
      .select('id, venue_id, wedding_date')
      .not('wedding_date', 'is', null)
      .gte('wedding_date', annivFrom.toISOString().slice(0, 10))
      .lte('wedding_date', annivTo.toISOString().slice(0, 10))
      .limit(2000);

    const venuesSeen = new Set<string>();
    for (const lead of (anniversaryLeads ?? []) as { id: string; venue_id: string; wedding_date: string }[]) {
      if (!venuesSeen.has(lead.venue_id)) {
        await ensureSystemTagsForVenue(lead.venue_id).catch(() => {});
        venuesSeen.add(lead.venue_id);
      }
      applySystemTag(lead.venue_id, lead.id, 'anniversary_year_1').catch(() => {});
      counts.anniversary_year_1++;
    }
  }

  // 3. ── Inactivity: inactive (45+ days), cold_lead (30+ days) ───────────────
  //    A lead is "inactive" if updated_at AND last_inbound_at (if set) are both old.
  {
    const { data: inactiveLeads } = await supabaseAdmin
      .from('leads')
      .select('id, venue_id, updated_at, last_inbound_at')
      .lt('updated_at', ago45.toISOString())
      .not('email', 'like', '%@ghl-sms.storypay.placeholder%')
      .limit(5000);

    const venuesSeen = new Set<string>();
    for (const lead of (inactiveLeads ?? []) as { id: string; venue_id: string; updated_at: string; last_inbound_at: string | null }[]) {
      const lastInbound = lead.last_inbound_at ? new Date(lead.last_inbound_at) : null;
      const lastActivity = lastInbound ?? new Date(lead.updated_at);
      if (lastActivity >= ago45) continue; // activity is recent enough

      if (!venuesSeen.has(lead.venue_id)) {
        await ensureSystemTagsForVenue(lead.venue_id).catch(() => {});
        venuesSeen.add(lead.venue_id);
      }
      applySystemTag(lead.venue_id, lead.id, 'inactive').catch(() => {});
      counts.inactive++;
    }
  }

  // 4. ── Cold lead: no activity for 30+ days ──────────────────────────────────
  {
    const { data: coldLeads } = await supabaseAdmin
      .from('leads')
      .select('id, venue_id, updated_at, last_inbound_at')
      .lt('updated_at', ago30.toISOString())
      .not('email', 'like', '%@ghl-sms.storypay.placeholder%')
      .limit(5000);

    const venuesSeen = new Set<string>();
    for (const lead of (coldLeads ?? []) as { id: string; venue_id: string; updated_at: string; last_inbound_at: string | null }[]) {
      const lastInbound = lead.last_inbound_at ? new Date(lead.last_inbound_at) : null;
      const lastActivity = lastInbound ?? new Date(lead.updated_at);
      if (lastActivity >= ago30) continue;

      if (!venuesSeen.has(lead.venue_id)) {
        await ensureSystemTagsForVenue(lead.venue_id).catch(() => {});
        venuesSeen.add(lead.venue_id);
      }
      applySystemTag(lead.venue_id, lead.id, 'cold_lead').catch(() => {});
      counts.cold_lead++;
    }
  }

  // 5. ── Re-engaged: had cold/inactive tag but replied in last 24 h ───────────
  //    Find leads with last_inbound_at in the last 24h that have cold_lead tag.
  {
    const { data: recentReplies } = await supabaseAdmin
      .from('leads')
      .select('id, venue_id, last_inbound_at')
      .not('last_inbound_at', 'is', null)
      .gte('last_inbound_at', ago24h.toISOString())
      .limit(2000);

    const venuesSeen = new Set<string>();
    for (const lead of (recentReplies ?? []) as { id: string; venue_id: string; last_inbound_at: string }[]) {
      // Only apply re_engaged if they had a cold/inactive tag
      const { data: tagCheck } = await supabaseAdmin
        .from('lead_tag_assignments')
        .select('tag_id, marketing_tags!inner(system_key)')
        .eq('lead_id', lead.id)
        .in('marketing_tags.system_key', ['cold_lead', 'inactive'])
        .limit(1)
        .maybeSingle();

      if (!tagCheck) continue;

      if (!venuesSeen.has(lead.venue_id)) {
        await ensureSystemTagsForVenue(lead.venue_id).catch(() => {});
        venuesSeen.add(lead.venue_id);
      }
      // Apply re_engaged, remove cold/inactive tags
      applySystemTag(lead.venue_id, lead.id, 're_engaged').catch(() => {});
      removeSystemTag(lead.venue_id, lead.id, 'cold_lead').catch(() => {});
      removeSystemTag(lead.venue_id, lead.id, 'inactive').catch(() => {});
      counts.re_engaged++;
    }
  }

  // 6. ── balance_due / past_due: open proposals with outstanding balance ───────
  {
    const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: openProposals } = await supabaseAdmin
      .from('proposals')
      .select('id, venue_id, customer_email, status, signed_at, created_at, payment_type')
      .in('status', ['signed', 'opened', 'sent'])
      .not('customer_email', 'is', null)
      .limit(5000);

    const venuesSeen = new Set<string>();
    for (const p of (openProposals ?? []) as {
      id: string; venue_id: string; customer_email: string;
      status: string; signed_at: string | null; created_at: string; payment_type: string | null;
    }[]) {
      if (!p.customer_email?.includes('@')) continue;

      if (!venuesSeen.has(p.venue_id)) {
        await ensureSystemTagsForVenue(p.venue_id).catch(() => {});
        venuesSeen.add(p.venue_id);
      }

      // Resolve lead by email
      const { data: lead } = await supabaseAdmin
        .from('leads')
        .select('id')
        .eq('venue_id', p.venue_id)
        .ilike('email', p.customer_email)
        .limit(1)
        .maybeSingle();

      if (!lead?.id) continue;

      // balance_due: any open proposal
      applySystemTag(p.venue_id, lead.id as string, 'balance_due').catch(() => {});
      counts.balance_due++;

      // past_due: signed but not paid, and signed more than 7 days ago
      if (p.status === 'signed' && p.signed_at) {
        const signedDate = new Date(p.signed_at);
        if (signedDate < sevenDaysAgo) {
          applySystemTag(p.venue_id, lead.id as string, 'past_due').catch(() => {});
          counts.past_due++;
        }
      }
    }
  }

  console.log('[cron/tag-sweep] complete', counts);
  return NextResponse.json({ ok: true, counts });
}
