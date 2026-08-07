/**
 * POST /api/admin/backfill-stop-contacts
 *
 * One-time retroactive backfill: applies the full STOP-keyword side-effects
 * (SMS DND, ai_state = opted_out, Not Interested stage move, activity log)
 * to 5 White Pine Manor leads that sent STOP via SMS but were not processed.
 *
 * GET  → dry-run preview (shows current state, makes no changes).
 * POST → applies the backfill. Idempotent: safe to re-run.
 *
 * venue_id: f7690c59-a194-4c01-adbf-67564eb29ad6 (White Pine Manor)
 */

import { NextResponse } from 'next/server';
import { getAdminIdentity } from '@/lib/admin-identity';
import { handleStopKeyword } from '@/lib/ghl-inbound-sms-side-effects';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VENUE_ID = 'f7690c59-a194-4c01-adbf-67564eb29ad6';

const TARGETS: { venueCustomerId: string; name: string; email: string }[] = [
  { venueCustomerId: '3a7b9440-f459-4770-9c99-d0c0b0be6860', name: 'Alyssa Killian',   email: 'alyssakillian@aol.com' },
  { venueCustomerId: '2a78d903-7953-4ada-8413-445ae95f6375', name: 'Robin Strand',      email: 'nibor1565@gmail.com' },
  { venueCustomerId: 'e1050bec-e590-4410-9144-e03678276dcf', name: 'Ernst De Waal',     email: 'ernstdw00@gmail.com' },
  { venueCustomerId: '892884ec-a586-40ed-b286-33af357dfa4f', name: 'Hayden Holcomb',    email: 'haydenholcomb82708@gmail.com' },
  { venueCustomerId: '825818f0-925f-4f75-a6aa-7fa4ce6bea9d', name: 'Katrina Washburn',  email: 'katmarie5279@gmail.com' },
];

async function isAdmin(): Promise<boolean> {
  const id = await getAdminIdentity();
  return id.isMasterSuperAdmin || !!(id.member);
}

async function fetchCurrentState() {
  const vcIds = TARGETS.map((t) => t.venueCustomerId);
  const emails = TARGETS.map((t) => t.email.toLowerCase());

  const { data: vcs } = await supabaseAdmin
    .from('venue_customers')
    .select('id, customer_email, sms_dnd, sms_dnd_source, conversation_dnd_inbound_sms')
    .in('id', vcIds);

  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, email, sms_dnd, ai_state, stage_id')
    .eq('venue_id', VENUE_ID)
    .in('email', emails);

  return { vcs: vcs ?? [], leads: leads ?? [] };
}

/** GET — dry-run: returns current state without making any changes. */
export async function GET(): Promise<NextResponse> {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { vcs, leads } = await fetchCurrentState();

    return NextResponse.json({
      note: 'Dry-run — POST to apply the backfill.',
      targets: TARGETS.map((t) => {
        const vc = vcs.find((v) => v.id === t.venueCustomerId);
        const matchedLeads = leads.filter(
          (l) => (l.email ?? '').toLowerCase() === t.email.toLowerCase(),
        );
        return {
          name: t.name,
          email: t.email,
          venue_customer: vc
            ? {
                id: vc.id,
                sms_dnd: vc.sms_dnd,
                sms_dnd_source: vc.sms_dnd_source,
                conversation_dnd_inbound_sms: vc.conversation_dnd_inbound_sms,
              }
            : 'NOT FOUND',
          leads: matchedLeads.map((l) => ({
            id: l.id,
            sms_dnd: l.sms_dnd,
            ai_state: l.ai_state,
            stage_id: l.stage_id,
          })),
        };
      }),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** POST — applies the full STOP backfill for all 5 contacts. */
export async function POST(): Promise<NextResponse> {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: { name: string; venueCustomerId: string; ok: boolean; error?: string }[] = [];

  for (const target of TARGETS) {
    try {
      await handleStopKeyword({
        venueId: VENUE_ID,
        venueCustomerId: target.venueCustomerId,
        messageBody: 'STOP',
        logPrefix: '[backfill-stop-contacts]',
      });
      results.push({ name: target.name, venueCustomerId: target.venueCustomerId, ok: true });
      console.log(`[backfill-stop-contacts] processed ${target.name} (${target.venueCustomerId})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ name: target.name, venueCustomerId: target.venueCustomerId, ok: false, error: msg });
      console.error(`[backfill-stop-contacts] failed for ${target.name}:`, err);
    }
  }

  const { vcs, leads } = await fetchCurrentState();

  return NextResponse.json({
    ok: results.every((r) => r.ok),
    processed: results,
    verification: TARGETS.map((t) => {
      const vc = vcs.find((v) => v.id === t.venueCustomerId);
      const matchedLeads = leads.filter(
        (l) => (l.email ?? '').toLowerCase() === t.email.toLowerCase(),
      );
      return {
        name: t.name,
        venue_customer: vc
          ? { sms_dnd: vc.sms_dnd, sms_dnd_source: vc.sms_dnd_source }
          : 'NOT FOUND',
        leads: matchedLeads.map((l) => ({
          id: l.id,
          sms_dnd: l.sms_dnd,
          ai_state: l.ai_state,
        })),
      };
    }),
  });
}
