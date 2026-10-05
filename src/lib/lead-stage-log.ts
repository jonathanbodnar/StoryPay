/**
 * Stage moves in a bride's thread (owner's ask, Oct 5 2026): every time a
 * lead is moved to another pipeline stage, the venue's conversation and the
 * support inbox show one line: when, to which stage, and who moved her.
 *
 * The move is written to the lead's activity log by the DATABASE (migration
 * 280: a trigger on leads.stage_id), because about twenty code paths can move
 * a lead (owner, team, support, the AI, automations, forms, Calendly) and a
 * new one must not be able to forget. The app's part is saying WHO, by
 * writing `stage_changed_by` in the same update as the move; a move that
 * doesn't say is an automation.
 *
 * These lines are NOT messages. They live in lead_activity_log, never in
 * conversation_messages, so they can't reach the couple's own chat, change
 * who "spoke last", or count as unread.
 */

import { supabaseAdmin } from '@/lib/supabase';

export type StageMoverKind = 'owner' | 'team' | 'support' | 'ai' | 'automation' | 'couple';

/** What to write to leads.stage_changed_by, in the same update as stage_id. */
export function stageMovedBy(kind: StageMoverKind, label?: string | null, memberId?: string | null) {
  return {
    kind,
    label: (label ?? '').trim() || null,
    member_id: memberId ?? null,
    // Makes each move's value new, so the database knows it belongs to this move.
    at: new Date().toISOString(),
  };
}

export type StageMover = ReturnType<typeof stageMovedBy>;

/**
 * Who is acting in this venue-dashboard request: the owner, a team member (by
 * name), or a StoryVenue admin viewing as the venue (said plainly, so a move
 * made while helping a venue isn't put down to its owner).
 */
export async function venueRequestMover(): Promise<StageMover> {
  try {
    const { getSessionUser } = await import('@/lib/session');
    const user = await getSessionUser();
    if (!user) return stageMovedBy('automation');
    const { cookies } = await import('next/headers');
    const { IMPERSONATION_COOKIE, isAdminImpersonating } = await import('@/lib/admin-impersonation');
    const jar = await cookies();
    if (isAdminImpersonating(jar.get(IMPERSONATION_COOKIE)?.value, user.venueId)) {
      return stageMovedBy('support', 'StoryVenue admin (viewing as the venue)');
    }
    return user.memberId ? stageMovedBy('team', user.memberName, user.memberId) : stageMovedBy('owner');
  } catch {
    return stageMovedBy('automation');
  }
}

/** Whether the database has leads.stage_changed_by yet (migration 280). Yes is remembered; no is asked again in a while. */
let moverColumn: { ok: boolean; at: number } | null = null;
async function hasMoverColumn(): Promise<boolean> {
  if (moverColumn?.ok) return true;
  if (moverColumn && Date.now() - moverColumn.at < 5 * 60_000) return false;
  const { error } = await supabaseAdmin.from('leads').select('stage_changed_by').limit(1);
  moverColumn = { ok: !error, at: Date.now() };
  return !error;
}

/**
 * Add who is moving the lead to a `leads` update that sets stage_id. Every
 * code path that knows who is acting wraps its update in this. On a database
 * that doesn't have the column yet the update goes through untouched: moving
 * a lead must never fail over the log.
 */
export async function withStageMover<T extends Record<string, unknown>>(
  update: T,
  mover: ReturnType<typeof stageMovedBy>,
): Promise<T> {
  if (!('stage_id' in update)) return update;
  return (await hasMoverColumn()) ? { ...update, stage_changed_by: mover } : update;
}

export interface StageMove {
  id: string;
  at: string;
  from: string | null;
  to: string;
  /** Who moved her, as the thread says it: "Jo Ann Wilkerson", "AI Concierge", "Automation"… */
  by: string;
  byKind: StageMoverKind;
}

export interface StageLogRow {
  id: string;
  lead_id: string;
  actor_member_id: string | null;
  actor_is_owner: boolean;
  details: Record<string, unknown> | null;
  created_at: string;
}

const KINDS: readonly StageMoverKind[] = ['owner', 'team', 'support', 'ai', 'automation', 'couple'];

/** Two log rows this close together, for the same lead and stage, are one move written twice. */
const SAME_MOVE_WITHIN_MS = 10_000;

/**
 * Log rows → the lines a thread shows, oldest first.
 *  - Who: the name written with the move; else the team member's name; else
 *    what kind of mover it was ("Owner", "AI Concierge", "Automation").
 *  - A move logged twice (by the database and, before migration 280's
 *    release, also by the route that made it) is shown once, keeping the row
 *    that names a person.
 *  - A row with no destination stage isn't a move anyone can read, and a
 *    new lead placed in its first stage by the system isn't a move at all.
 */
export function stageMoveLines(
  rows: readonly StageLogRow[],
  names: { members?: Record<string, string>; owner?: string | null } = {},
): StageMove[] {
  const lines: Array<StageMove & { leadId: string; toId: string; fromId: string }> = [];
  for (const row of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const d = row.details ?? {};
    const to = String(d.to_stage_name ?? '').trim();
    if (!to) continue;
    const said = String(d.actor_kind ?? '').trim() as StageMoverKind;
    const byKind: StageMoverKind = KINDS.includes(said)
      ? said
      : row.actor_member_id ? 'team' : row.actor_is_owner ? 'owner' : 'automation';
    // A new lead being placed on the board by the system isn't a move.
    if (!d.from_stage_id && !d.from_stage_name && (byKind === 'automation' || byKind === 'couple')) continue;
    const label = String(d.actor_label ?? '').trim();
    const member = row.actor_member_id ? names.members?.[row.actor_member_id] : undefined;
    const by = label
      || member
      || (byKind === 'owner' ? (names.owner?.trim() || 'Owner')
        : byKind === 'team' ? 'Team member'
          : byKind === 'support' ? 'StoryVenue Support'
            : byKind === 'ai' ? 'AI Concierge'
              : byKind === 'couple' ? 'The couple'
                : 'Automation');
    const line = {
      id: row.id, at: row.created_at, from: String(d.from_stage_name ?? '').trim() || null, to, by, byKind,
      leadId: row.lead_id, toId: String(d.to_stage_id ?? to), fromId: String(d.from_stage_id ?? d.from_stage_name ?? ''),
    };
    // The same move written twice: this lead's previous line, same stages, seconds
    // apart. (Back to a stage she was in a moment ago is a move of its own.)
    const previous = lines.findLast((l) => l.leadId === line.leadId);
    const twin = previous && previous.toId === line.toId && previous.fromId === line.fromId
      && Math.abs(Date.parse(line.at) - Date.parse(previous.at)) < SAME_MOVE_WITHIN_MS ? previous : null;
    if (!twin) {
      lines.push(line);
    } else if (twin.byKind === 'automation' && line.byKind !== 'automation') {
      lines[lines.indexOf(twin)] = { ...line, at: twin.at };
    }
  }
  return lines.map((l) => ({ id: l.id, at: l.at, from: l.from, to: l.to, by: l.by, byKind: l.byKind }));
}

/** "Moved to Tour Booked by Jo Ann Wilkerson" (from "Qualified" when known). */
export function stageMoveSentence(move: Pick<StageMove, 'from' | 'to' | 'by'>): string {
  return `Moved ${move.from ? `from ${move.from} ` : ''}to ${move.to} by ${move.by}`;
}

const digits = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '').slice(-10);

/**
 * The stage moves of the lead(s) behind a thread's contact, for the venue's
 * conversation and the support inbox. Best-effort: a thread still loads if
 * the log can't be read.
 */
export async function loadStageMovesForCustomer(venueId: string, venueCustomerId: string): Promise<StageMove[]> {
  try {
    const { data: customer } = await supabaseAdmin
      .from('venue_customers').select('customer_email, phone').eq('id', venueCustomerId).eq('venue_id', venueId).maybeSingle();
    const email = String((customer as { customer_email?: string | null } | null)?.customer_email ?? '').trim().toLowerCase();
    const phone = digits((customer as { phone?: string | null } | null)?.phone);
    if (!email && !phone) return [];

    const leadIds = new Set<string>();
    if (email && !email.endsWith('.placeholder')) {
      const { data } = await supabaseAdmin.from('leads').select('id').eq('venue_id', venueId).ilike('email', email).limit(20);
      for (const l of (data ?? []) as Array<{ id: string }>) leadIds.add(l.id);
    }
    if (!leadIds.size && phone.length === 10) {
      const { data } = await supabaseAdmin.from('leads').select('id, phone').eq('venue_id', venueId).ilike('phone', `%${phone.slice(-4)}`).limit(50);
      for (const l of (data ?? []) as Array<{ id: string; phone: string | null }>) if (digits(l.phone) === phone) leadIds.add(l.id);
    }
    if (!leadIds.size) return [];

    const { data: rows, error } = await supabaseAdmin
      .from('lead_activity_log')
      .select('id, lead_id, actor_member_id, actor_is_owner, details, created_at')
      .eq('venue_id', venueId).in('lead_id', [...leadIds]).eq('action', 'stage_changed')
      .order('created_at', { ascending: true }).limit(300);
    if (error || !rows?.length) return [];

    const memberIds = [...new Set((rows as StageLogRow[]).map((r) => r.actor_member_id).filter(Boolean) as string[])];
    const members: Record<string, string> = {};
    if (memberIds.length) {
      const { data } = await supabaseAdmin.from('venue_team_members').select('id, first_name, last_name').in('id', memberIds);
      for (const m of (data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null }>) {
        const name = [m.first_name, m.last_name].filter(Boolean).join(' ').trim();
        if (name) members[m.id] = name;
      }
    }
    let owner: string | null = null;
    if ((rows as StageLogRow[]).some((r) => r.actor_is_owner || r.details?.actor_kind === 'owner')) {
      const { data } = await supabaseAdmin.from('venues').select('owner_first_name, owner_last_name').eq('id', venueId).maybeSingle();
      const v = data as { owner_first_name?: string | null; owner_last_name?: string | null } | null;
      owner = [v?.owner_first_name, v?.owner_last_name].filter(Boolean).join(' ').trim() || null;
    }
    return stageMoveLines(rows as StageLogRow[], { members, owner });
  } catch (e) {
    console.warn('[lead-stage-log] could not load stage moves', e instanceof Error ? e.message : e);
    return [];
  }
}
