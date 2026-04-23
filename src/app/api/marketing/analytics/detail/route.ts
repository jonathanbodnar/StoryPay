import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export type AnalyticsDetailRow = {
  leadId: string;
  name: string | null;
  email: string;
  phone: string | null;
  date: string | null;
  extra: string | null;
};

export type AnalyticsDetailType =
  | 'sent'
  | 'opened'
  | 'bounced'
  | 'unsubscribes'
  | 'spam'
  | 'suppressions';

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const type = (searchParams.get('type') ?? '') as AnalyticsDetailType;
  const search = (searchParams.get('search') ?? '').trim().toLowerCase();
  const page = Math.max(0, parseInt(searchParams.get('page') ?? '0', 10));

  const isSuppression = ['unsubscribes', 'spam', 'suppressions'].includes(type);
  const isRecipient = ['sent', 'opened', 'bounced'].includes(type);

  if (!isSuppression && !isRecipient) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }

  try {
    if (isRecipient) {
      // Pull from marketing_campaign_recipients
      let query = supabaseAdmin
        .from('marketing_campaign_recipients')
        .select('lead_id, email, sent_at, opened_at, error, status')
        .eq('venue_id', venueId);

      if (type === 'sent') query = query.eq('status', 'sent');
      else if (type === 'opened') query = query.eq('status', 'sent').not('opened_at', 'is', null);
      else if (type === 'bounced') query = query.eq('status', 'failed');

      // We need to get all rows first (up to a cap) then deduplicate by lead_id
      const { data: allRows, error: rErr } = await query
        .order('sent_at', { ascending: false })
        .limit(5000);

      if (rErr) {
        console.error('[analytics/detail recipients]', rErr);
        return NextResponse.json({ error: rErr.message }, { status: 500 });
      }

      // Deduplicate by lead_id – keep most recent row per lead
      const byLead = new Map<string, { email: string; sent_at: string | null; opened_at: string | null; error: string | null; count: number }>();
      for (const r of allRows ?? []) {
        const row = r as { lead_id: string; email: string; sent_at: string | null; opened_at: string | null; error: string | null };
        const existing = byLead.get(row.lead_id);
        if (existing) {
          existing.count++;
        } else {
          byLead.set(row.lead_id, {
            email: row.email,
            sent_at: row.sent_at,
            opened_at: row.opened_at,
            error: row.error,
            count: 1,
          });
        }
      }

      const leadIds = [...byLead.keys()];

      // Fetch lead details for name + phone
      const leadDetails = new Map<string, { name: string | null; phone: string | null }>();
      if (leadIds.length > 0) {
        const { data: leads } = await supabaseAdmin
          .from('leads')
          .select('id, name, phone')
          .in('id', leadIds)
          .eq('venue_id', venueId);
        for (const l of leads ?? []) {
          const lead = l as { id: string; name: string | null; phone: string | null };
          leadDetails.set(lead.id, { name: lead.name, phone: lead.phone });
        }
      }

      // Build output rows
      let rows: AnalyticsDetailRow[] = [];
      for (const [leadId, rec] of byLead) {
        const ld = leadDetails.get(leadId);
        const date = type === 'opened' ? rec.opened_at : rec.sent_at;
        const extra = rec.count > 1
          ? `${rec.count} email${rec.count === 1 ? '' : 's'}`
          : (type === 'bounced' && rec.error ? rec.error : null);
        rows.push({
          leadId,
          name: ld?.name ?? null,
          email: rec.email,
          phone: ld?.phone ?? null,
          date,
          extra,
        });
      }

      // Apply search filter
      if (search) {
        rows = rows.filter((r) =>
          (r.name ?? '').toLowerCase().includes(search) ||
          r.email.toLowerCase().includes(search) ||
          (r.phone ?? '').toLowerCase().includes(search)
        );
      }

      // Sort by date desc
      rows.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

      const total = rows.length;
      const paged = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      return NextResponse.json({ rows: paged, total, page, hasMore: (page + 1) * PAGE_SIZE < total });

    } else {
      // Pull from marketing_email_suppressions
      let query = supabaseAdmin
        .from('marketing_email_suppressions')
        .select('lead_id, reason, created_at')
        .eq('venue_id', venueId);

      if (type === 'unsubscribes') query = query.eq('reason', 'unsubscribe');
      else if (type === 'spam') query = query.eq('reason', 'spam');
      // 'suppressions' = all reasons

      const { data: supRows, error: sErr } = await query
        .order('created_at', { ascending: false })
        .limit(5000);

      if (sErr) {
        console.error('[analytics/detail suppressions]', sErr);
        return NextResponse.json({ error: sErr.message }, { status: 500 });
      }

      const leadIds = [...new Set((supRows ?? []).map((r: { lead_id: string }) => r.lead_id))];

      const leadDetails = new Map<string, { name: string | null; email: string; phone: string | null }>();
      if (leadIds.length > 0) {
        const { data: leads } = await supabaseAdmin
          .from('leads')
          .select('id, name, email, phone')
          .in('id', leadIds)
          .eq('venue_id', venueId);
        for (const l of leads ?? []) {
          const lead = l as { id: string; name: string | null; email: string; phone: string | null };
          leadDetails.set(lead.id, { name: lead.name, email: lead.email, phone: lead.phone });
        }
      }

      let rows: AnalyticsDetailRow[] = (supRows ?? []).map((r) => {
        const row = r as { lead_id: string; reason: string; created_at: string };
        const ld = leadDetails.get(row.lead_id);
        return {
          leadId: row.lead_id,
          name: ld?.name ?? null,
          email: ld?.email ?? '',
          phone: ld?.phone ?? null,
          date: row.created_at,
          extra: type === 'suppressions' ? row.reason : null,
        };
      });

      // Apply search filter
      if (search) {
        rows = rows.filter((r) =>
          (r.name ?? '').toLowerCase().includes(search) ||
          r.email.toLowerCase().includes(search) ||
          (r.phone ?? '').toLowerCase().includes(search)
        );
      }

      const total = rows.length;
      const paged = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      return NextResponse.json({ rows: paged, total, page, hasMore: (page + 1) * PAGE_SIZE < total });
    }
  } catch (err) {
    console.error('[analytics/detail]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
