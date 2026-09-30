/**
 * /api/couple/home — the Wedding Planner home (the couple's dashboard).
 *
 *   GET   → the couple's names, date and cover photo (their wedding website's
 *           cover, the one image that themes both), the setup checklist
 *           (lib/couple-planner-setup.ts), and the dashboard metrics: website
 *           views, RSVP replies, guests coming, guestbook notes, invites sent,
 *           to-dos, budget and vendors, and (for a couple whose venue is
 *           connected) what they've paid the venue and their next payment.
 *   PATCH → { key, done } ticks or unticks a checklist item by hand
 *           (done: null goes back to the automatic check).
 *
 * Every couple has a planner, with or without a venue (lib/couple-weddings.ts),
 * so this creates it on first visit. Invited helpers (collaborators) get the
 * metrics for the planner they help with, but not the couple's checklist,
 * budget or website stats.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';
import {
  ensureCouplePlanner,
  resolveCoupleWeddingAccess,
  summarizeWeddingGuests,
  type ResolvedCoupleWedding,
} from '@/lib/couple-weddings';
import { sanitizeChecklist } from '@/lib/wedding-checklist';
import { sanitizeBudget } from '@/lib/wedding-budget';
import { sanitizeInspiration } from '@/lib/wedding-inspiration';
import { sanitizeVendors } from '@/lib/wedding-vendors';
import { getPinterestConnection } from '@/lib/pinterest';
import { planPayments, toYmd } from '@/lib/payment-plan';
import {
  PLANNER_SETUP_ITEMS,
  isPlannerSetupKey,
  type PlannerSetupKey,
  type PlannerSetupState,
} from '@/lib/couple-planner-setup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Overrides = Partial<Record<PlannerSetupKey, boolean>>;

function readOverrides(raw: unknown): Overrides {
  const out: Overrides = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isPlannerSetupKey(k) && typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface CouplePayments {
  paidCents: number;
  totalCents: number;
  balanceCents: number;
  next: { amountCents: number; date: string | null } | null;
  url: string;
}

/**
 * What the couple has paid their venue and what's next, from the proposals
 * and invoices the venue sent to the couple's email. Private to the couple.
 */
async function couplePayments(
  venueId: string,
  venueCustomerId: string | null,
  authEmail: string | null,
): Promise<CouplePayments | null> {
  const emails = new Set<string>();
  if (authEmail) emails.add(authEmail.trim());
  if (venueCustomerId) {
    const { data: vc } = await supabaseAdmin.from('venue_customers').select('customer_email').eq('id', venueCustomerId).maybeSingle();
    const e = (vc as { customer_email?: string | null } | null)?.customer_email?.trim();
    if (e) emails.add(e);
  }
  const variants = [...new Set([...emails].flatMap((e) => [e, e.toLowerCase()]))];
  if (!variants.length) return null;

  const { data } = await supabaseAdmin
    .from('proposals')
    .select('id, public_token, price, status, payment_type, payment_config, payment_provider, collect_manually, created_at')
    .eq('venue_id', venueId)
    .in('customer_email', variants)
    .in('status', ['sent', 'opened', 'signed', 'paid', 'partially_paid', 'partial_refund'])
    .order('created_at', { ascending: false })
    .limit(20);
  const docs = (data ?? []) as Array<{
    id: string; public_token: string; price: number; status: string; payment_type: string | null;
    payment_config: unknown; payment_provider: string | null; collect_manually: boolean | null;
  }>;
  if (!docs.length) return null;

  const ids = docs.map((d) => d.id);
  const [{ data: ledger }, { data: rows }] = await Promise.all([
    supabaseAdmin.from('proposal_payments').select('proposal_id, amount_cents, refunded_cents').in('proposal_id', ids),
    supabaseAdmin.from('proposal_installments').select('proposal_id, amount_cents, due_date').in('proposal_id', ids).eq('status', 'scheduled'),
  ]);
  // Balances count everything paid (a refund is a credit); "paid" shown to them is net of refunds.
  const paidBy = new Map<string, number>();
  let refundedCents = 0;
  for (const r of (ledger ?? []) as Array<{ proposal_id: string; amount_cents: number; refunded_cents: number | null }>) {
    paidBy.set(r.proposal_id, (paidBy.get(r.proposal_id) ?? 0) + (Number(r.amount_cents) || 0));
    refundedCents += Number(r.refunded_cents) || 0;
  }

  let paidCents = 0;
  let totalCents = 0;
  let next: (CouplePayments['next'] & { url: string }) | null = null;
  const consider = (amountCents: number, date: string | null, url: string) => {
    if (amountCents <= 0) return;
    if (!next || (date ?? '') < (next.date ?? '')) next = { amountCents, date, url };
  };
  for (const d of docs) {
    const price = Math.round(Number(d.price) || 0);
    const paid = paidBy.get(d.id) ?? 0;
    paidCents += paid;
    totalCents += price;
    if (paid >= price) continue;
    const url = paid > 0 ? `/invoice/${d.id}` : `/proposal/${d.public_token}`;
    const auto = (rows ?? []) as Array<{ proposal_id: string; amount_cents: number; due_date: string }>;
    const scheduled = auto.filter((r) => r.proposal_id === d.id).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
    if (scheduled) {
      consider(scheduled.amount_cents, String(scheduled.due_date).slice(0, 10), url);
    } else if (d.payment_type === 'installment') {
      // The first payment of the schedule not yet covered.
      let running = 0;
      for (const s of planPayments(d.payment_config)) {
        running += s.amount;
        if (paid < running) {
          // An online plan's first payment is due when they sign.
          consider(Math.min(s.amount, running - paid), paid === 0 && d.collect_manually !== true ? null : toYmd(s.date), url);
          break;
        }
      }
    } else {
      consider(price - paid, toYmd((d.payment_config as { due_date?: unknown } | null)?.due_date), url);
    }
  }
  const n = next as (CouplePayments['next'] & { url: string }) | null;
  return {
    paidCents: paidCents - refundedCents,
    totalCents,
    balanceCents: Math.max(totalCents - paidCents, 0),
    next: n ? { amountCents: n.amountCents, date: n.date } : null,
    url: n?.url ?? `/invoice/${docs[0].id}`,
  };
}

export async function GET(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let resolved: ResolvedCoupleWedding | null = await resolveCoupleWeddingAccess(user.id);
  if (!resolved) {
    const planner = await ensureCouplePlanner(user.id);
    if (planner) resolved = { wedding: planner, access: 'owner', collaboratorId: null };
  }
  const access = resolved?.access ?? null;
  const wedding = (resolved?.wedding ?? null) as (Record<string, unknown> & { id: string; status: string; couple_id: string | null }) | null;
  const isCouple = access === 'owner';
  // Names, date and website belong to the couple who owns the planner.
  const coupleId = wedding?.couple_id ?? user.id;

  const since7 = new Date(Date.now() - 7 * DAY_MS).toISOString().slice(0, 10);
  const [{ data: profile }, { data: site }, { data: guestRows }, { data: sends }] = await Promise.all([
    supabaseAdmin
      .from('couple_profiles')
      .select('first_name, partner_first_name, wedding_date, planner_setup')
      .eq('id', coupleId)
      .maybeSingle(),
    // The couple's website row: its cover themes the dashboard for everyone
    // on the planner; its stats are the couple's only.
    supabaseAdmin.from('couple_sites').select('id, slug, is_published, cover_url').eq('couple_id', coupleId).maybeSingle(),
    wedding
      ? supabaseAdmin.from('wedding_guests').select('rsvp_status, party_size, meal_choice').eq('couple_wedding_id', wedding.id)
      : Promise.resolve({ data: [] }),
    wedding && isCouple
      ? supabaseAdmin.from('couple_website_invite_sends').select('sent_count').eq('couple_wedding_id', wedding.id)
      : Promise.resolve({ data: [] }),
  ]);

  const prof = (profile ?? {}) as { first_name?: string | null; partner_first_name?: string | null; wedding_date?: string | null; planner_setup?: unknown };
  const siteAny = site as { id: string; slug: string | null; is_published: boolean | null; cover_url: string | null } | null;
  const siteRow = isCouple ? siteAny : null;

  const [views, guestbook, collaborators, pinterest] = await Promise.all([
    siteRow
      ? supabaseAdmin.from('couple_site_views').select('day, views').eq('site_id', siteRow.id)
      : Promise.resolve({ data: [] }),
    siteRow
      ? supabaseAdmin.from('couple_guestbook_entries').select('id', { count: 'exact', head: true }).eq('couple_site_id', siteRow.id).eq('is_hidden', false)
      : Promise.resolve({ count: 0 }),
    wedding && isCouple
      ? supabaseAdmin.from('wedding_planner_collaborators').select('id', { count: 'exact', head: true }).eq('couple_wedding_id', wedding.id).neq('status', 'revoked')
      : Promise.resolve({ count: 0 }),
    isCouple ? getPinterestConnection(user.id).catch(() => ({ connected: false })) : Promise.resolve({ connected: false }),
  ]);

  const guests = summarizeWeddingGuests(
    (guestRows ?? []) as { rsvp_status: string | null; party_size: number | null; meal_choice: string | null }[],
  );
  const checklist = sanitizeChecklist(wedding?.checklist);
  const budget = isCouple ? sanitizeBudget(wedding?.budget) : null;
  const inspirationCount = sanitizeInspiration(wedding?.inspiration).items.length;
  const vendorCount = sanitizeVendors(wedding?.vendors).items.length;
  const viewRows = (views.data ?? []) as { day: string; views: number }[];
  const invitesSent = ((sends ?? []) as { sent_count: number | null }[]).reduce((s, r) => s + (r.sent_count ?? 0), 0);

  // ── Setup checklist (the couple only) ──────────────────────────────────
  let setup: { items: PlannerSetupState[]; doneCount: number; total: number } | null = null;
  if (isCouple) {
    const auto: Record<PlannerSetupKey, boolean> = {
      wedding_date: Boolean(prof.wedding_date),
      website: siteRow?.is_published === true,
      guests: guests.total > 0,
      website_invite: invitesSent > 0,
      inspiration: inspirationCount > 0 || pinterest.connected,
      budget: Boolean(budget && (budget.target > 0 || budget.lines.length > 0)),
      partner: (collaborators.count ?? 0) > 0,
    };
    const overrides = readOverrides(prof.planner_setup);
    const items = PLANNER_SETUP_ITEMS.map((item): PlannerSetupState => ({
      key: item.key,
      auto: auto[item.key],
      done: overrides[item.key] ?? auto[item.key],
    }));
    setup = { items, doneCount: items.filter((i) => i.done).length, total: items.length };
  }

  // What they've paid the venue: the couple only, once their venue is connected.
  const w = wedding as (typeof wedding & { venue_id?: string | null; venue_customer_id?: string | null }) | null;
  const payments =
    isCouple && w?.status === 'linked' && w.venue_id
      ? await couplePayments(w.venue_id, w.venue_customer_id ?? null, user.email ?? null).catch(() => null)
      : null;

  const todoItems = checklist.items;
  const nextTodo =
    todoItems.filter((i) => !i.done).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))[0] ?? null;

  return NextResponse.json({
    access,
    venueConnected: wedding?.status === 'linked',
    couple: {
      firstName: prof.first_name ?? null,
      partnerFirstName: prof.partner_first_name ?? null,
      weddingDate: prof.wedding_date ?? null,
      coverUrl: siteAny?.cover_url ?? null,
    },
    setup,
    metrics: {
      website: isCouple
        ? {
            status: siteRow?.is_published ? 'published' : siteRow ? 'draft' : 'none',
            slug: siteRow?.slug ?? null,
            views: viewRows.reduce((s, r) => s + (r.views ?? 0), 0),
            viewsThisWeek: viewRows.filter((r) => r.day >= since7).reduce((s, r) => s + (r.views ?? 0), 0),
            guestbook: guestbook.count ?? 0,
          }
        : null,
      guests: {
        total: guests.total,
        attending: guests.attending,
        declined: guests.declined,
        awaiting: guests.pending,
        replied: guests.attending + guests.declined,
        headcount: guests.headcount,
      },
      invitesSent: isCouple ? invitesSent : null,
      todos: {
        done: todoItems.filter((i) => i.done).length,
        total: todoItems.length,
        next: nextTodo ? { title: nextTodo.title, dueDate: nextTodo.dueDate || null } : null,
      },
      budget: budget
        ? {
            target: budget.target,
            estimated: budget.lines.reduce((s, l) => s + (l.estimated || 0), 0),
            actual: budget.lines.reduce((s, l) => s + (l.actual || 0), 0),
          }
        : null,
      vendors: vendorCount,
      inspiration: inspirationCount,
      payments,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { key?: unknown; done?: unknown };
  if (!isPlannerSetupKey(body.key)) return NextResponse.json({ error: 'Unknown checklist item' }, { status: 400 });
  if (body.done !== null && typeof body.done !== 'boolean') {
    return NextResponse.json({ error: 'done must be true, false or null' }, { status: 400 });
  }

  const resolved = await resolveCoupleWeddingAccess(user.id);
  if (resolved && resolved.access !== 'owner') {
    return NextResponse.json({ error: 'Only the couple can change their checklist.' }, { status: 403 });
  }

  const { data: profile } = await supabaseAdmin
    .from('couple_profiles')
    .select('planner_setup')
    .eq('id', user.id)
    .maybeSingle();
  const overrides = readOverrides((profile as { planner_setup?: unknown } | null)?.planner_setup);
  if (body.done === null) delete overrides[body.key];
  else overrides[body.key] = body.done;

  const { error } = profile
    ? await supabaseAdmin.from('couple_profiles').update({ planner_setup: overrides }).eq('id', user.id)
    : await supabaseAdmin.from('couple_profiles').insert({ id: user.id, planner_setup: overrides });
  if (error) {
    console.error('[couple/home] could not save the checklist:', error.message);
    return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
