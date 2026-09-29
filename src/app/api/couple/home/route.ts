/**
 * /api/couple/home — the Wedding Planner home (overview) page.
 *
 *   GET   → the setup checklist (lib/couple-planner-setup.ts) for the couple
 *           who owns the planner, and the "at a glance" numbers (guests,
 *           to-dos, budget, website).
 *   PATCH → { key, done } ticks or unticks a checklist item by hand
 *           (done: null goes back to the automatic check).
 *
 * The checklist belongs to the couple, so invited helpers (collaborators) get
 * the numbers but not the checklist.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { resolveCoupleWeddingAccess, summarizeWeddingGuests } from '@/lib/couple-weddings';
import { sanitizeChecklist } from '@/lib/wedding-checklist';
import { sanitizeBudget } from '@/lib/wedding-budget';
import { sanitizeInspiration } from '@/lib/wedding-inspiration';
import { getPinterestConnection } from '@/lib/pinterest';
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

export async function GET(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const resolved = await resolveCoupleWeddingAccess(user.id);
  const access = resolved?.access ?? null;
  const wedding = (resolved?.wedding ?? null) as (Record<string, unknown> & { id: string; status: string }) | null;
  const linked = wedding?.status === 'linked';
  // The couple whose planner this is: the owner, or a couple with no venue yet.
  const isPlannerCouple = access === 'owner' || access === null;

  const [{ data: profile }, { data: site }, guestRows] = await Promise.all([
    supabaseAdmin.from('couple_profiles').select('wedding_date, planner_setup').eq('id', user.id).maybeSingle(),
    isPlannerCouple
      ? supabaseAdmin.from('couple_sites').select('slug, is_published').eq('couple_id', user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    linked && wedding
      ? supabaseAdmin.from('wedding_guests').select('rsvp_status, party_size, meal_choice').eq('couple_wedding_id', wedding.id)
      : Promise.resolve({ data: [] }),
  ]);

  const guests = linked
    ? summarizeWeddingGuests(((guestRows.data ?? []) as { rsvp_status: string | null; party_size: number | null; meal_choice: string | null }[]))
    : null;
  const checklist = linked ? sanitizeChecklist(wedding?.checklist) : null;
  const budget = linked && access === 'owner' ? sanitizeBudget(wedding?.budget) : null;
  const siteRow = site as { slug: string | null; is_published: boolean | null } | null;

  // ── Setup checklist (the planner's couple only) ────────────────────────
  let setup: { items: PlannerSetupState[]; doneCount: number; total: number; venuePending: boolean } | null = null;
  if (isPlannerCouple) {
    const [inviteSends, collaborators, pinterest] = await Promise.all([
      linked && wedding
        ? supabaseAdmin.from('couple_website_invite_sends').select('id', { count: 'exact', head: true }).eq('couple_wedding_id', wedding.id).gt('sent_count', 0)
        : Promise.resolve({ count: 0 }),
      linked && wedding
        ? supabaseAdmin.from('wedding_planner_collaborators').select('id', { count: 'exact', head: true }).eq('couple_wedding_id', wedding.id).neq('status', 'revoked')
        : Promise.resolve({ count: 0 }),
      getPinterestConnection(user.id).catch(() => ({ connected: false })),
    ]);
    const inspirationItems = linked ? sanitizeInspiration(wedding?.inspiration).items.length : 0;

    const auto: Record<PlannerSetupKey, boolean> = {
      wedding_date: Boolean((profile as { wedding_date?: string | null } | null)?.wedding_date),
      venue: linked,
      website: siteRow?.is_published === true,
      guests: (guests?.total ?? 0) > 0,
      website_invite: (inviteSends.count ?? 0) > 0,
      inspiration: inspirationItems > 0 || pinterest.connected,
      budget: Boolean(budget && (budget.target > 0 || budget.lines.length > 0)),
      partner: (collaborators.count ?? 0) > 0,
    };
    const overrides = readOverrides((profile as { planner_setup?: unknown } | null)?.planner_setup);
    const items = PLANNER_SETUP_ITEMS.map((item): PlannerSetupState => {
      const locked = item.needsVenue && !linked;
      return {
        key: item.key,
        auto: auto[item.key],
        locked,
        done: locked ? false : overrides[item.key] ?? auto[item.key],
      };
    });
    setup = {
      items,
      doneCount: items.filter((i) => i.done).length,
      total: items.length,
      venuePending: wedding?.status === 'pending',
    };
  }

  // ── At a glance ─────────────────────────────────────────────────────────
  const todoItems = checklist?.items ?? [];
  const nextTodo = todoItems
    .filter((i) => !i.done)
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))[0] ?? null;

  return NextResponse.json({
    access,
    linked,
    setup,
    glance: {
      guests,
      todos: checklist
        ? {
            done: todoItems.filter((i) => i.done).length,
            total: todoItems.length,
            next: nextTodo ? { title: nextTodo.title, dueDate: nextTodo.dueDate || null } : null,
          }
        : null,
      budget: budget
        ? {
            target: budget.target,
            estimated: budget.lines.reduce((s, l) => s + (l.estimated || 0), 0),
            actual: budget.lines.reduce((s, l) => s + (l.actual || 0), 0),
          }
        : null,
      website: isPlannerCouple
        ? {
            status: siteRow?.is_published ? 'published' : siteRow ? 'draft' : 'none',
            slug: siteRow?.slug ?? null,
          }
        : null,
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
