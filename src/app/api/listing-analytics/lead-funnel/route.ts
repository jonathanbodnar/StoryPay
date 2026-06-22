import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/listing-analytics/lead-funnel
 *
 * Powers the "Bride Booking System" dashboard funnel: a cumulative count of
 * how far leads have progressed through the booking journey. Milestones map
 * onto the venue's pipeline stages (see DEFAULT_STAGE_TEMPLATE):
 *
 *   Leads → Conversations Started → Booked Tours → Booked Weddings
 *
 * The funnel is cumulative — a lead that booked a wedding is counted in every
 * earlier milestone too. Lost leads (kind="lost" / status="not_interested")
 * still count as a Lead but are excluded from the progressed milestones.
 *
 * Always live: the client polls this on the same 30s cadence as the realtime
 * panel so the numbers stay current without a manual refresh.
 */

type StageInfo = { name: string; kind: string; position: number };

function leadRank(
  status: string,
  stage: StageInfo | undefined,
): { rank: 1 | 2 | 3 | 4; lost: boolean } {
  const name = (stage?.name ?? '').toLowerCase();
  const kind = stage?.kind ?? '';
  const lost = kind === 'lost' || status === 'not_interested';
  const won = kind === 'won' || status === 'booked_wedding';

  if (won) return { rank: 4, lost: false };
  if (name.includes('tour') || name.includes('proposal') || status === 'tour_booked' || status === 'proposal_sent') {
    return { rank: 3, lost };
  }
  if (name.includes('conversation') || name.includes('contacted') || name.includes('follow up') || status === 'contacted') {
    return { rank: 2, lost };
  }
  return { rank: 1, lost };
}

export async function GET() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [{ data: leads }, { data: stages }] = await Promise.all([
    supabaseAdmin
      .from('leads')
      .select('id, status, stage_id')
      .eq('venue_id', venueId)
      .limit(5000),
    supabaseAdmin
      .from('lead_pipeline_stages')
      .select('id, name, kind, position')
      .eq('venue_id', venueId),
  ]);

  const stageById = new Map<string, StageInfo>(
    ((stages ?? []) as Array<{ id: string; name: string; kind: string; position: number }>).map((s) => [
      s.id,
      { name: s.name, kind: s.kind, position: s.position },
    ]),
  );

  let leadsCount = 0;
  let conversations = 0;
  let tours = 0;
  let weddings = 0;

  for (const row of (leads ?? []) as Array<{ status: string; stage_id: string | null }>) {
    leadsCount += 1;
    const { rank, lost } = leadRank(row.status ?? 'new', row.stage_id ? stageById.get(row.stage_id) : undefined);
    if (rank >= 4) weddings += 1;
    if (rank >= 3 && !lost) tours += 1;
    if (rank >= 2 && !lost) conversations += 1;
  }

  const steps = [
    { key: 'leads', label: 'Leads', count: leadsCount },
    { key: 'conversations', label: 'Conversations Started', count: conversations },
    { key: 'tours', label: 'Booked Tours', count: tours },
    { key: 'weddings', label: 'Booked Weddings', count: weddings },
  ];

  // Conversion % between each consecutive milestone (to / from).
  const conversions = steps.slice(1).map((step, i) => {
    const from = steps[i].count;
    return from > 0 ? Math.round((step.count / from) * 100) : null;
  });

  return NextResponse.json({ steps, conversions });
}
