/**
 * Unified contact directory for the super-admin Contacts page.
 *
 * A "contact" is anyone in StoryVenue with any kind of presence on the
 * platform — venue owners, couples, venue team members, internal admin
 * staff, directory leads, and waitlist signups. They live in different
 * tables with different schemas; this module flattens them into one
 * shape and is the single source of truth for the new /admin/contacts
 * page.
 */

import { supabaseAdmin } from '@/lib/supabase';

export type ContactType =
  | 'venue_owner'      // public.venues.row — owner identity lives on the venue
  | 'couple'           // public.couple_profiles + auth.users
  | 'venue_team'       // public.venue_team_members
  | 'admin_team'       // public.support_team_members
  | 'lead'             // public.leads (directory inquiry forms)
  | 'waitlist';        // public.waitlist (pre-launch signups)

export const CONTACT_TYPES: ContactType[] = [
  'venue_owner',
  'couple',
  'venue_team',
  'admin_team',
  'lead',
  'waitlist',
];

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  venue_owner: 'Venue owner',
  couple:      'Couple',
  venue_team:  'Venue team',
  admin_team:  'Admin team',
  lead:        'Lead',
  waitlist:    'Waitlist',
};

/** Pill colors keyed by contact type — Tailwind utility strings. */
export const CONTACT_TYPE_PILL: Record<ContactType, string> = {
  venue_owner: 'bg-violet-100 text-violet-700 border-violet-200',
  couple:      'bg-rose-100 text-rose-700 border-rose-200',
  venue_team:  'bg-amber-100 text-amber-700 border-amber-200',
  admin_team:  'bg-gray-200 text-gray-800 border-gray-300',
  lead:        'bg-sky-100 text-sky-700 border-sky-200',
  waitlist:    'bg-emerald-100 text-emerald-700 border-emerald-200',
};

/** Single flattened contact row returned to the admin Contacts UI. */
export interface AdminContact {
  type: ContactType;
  /** Stable per-type id used for follow-up API calls (PATCH, impersonate, …). */
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  /** Free-text role / extra context shown next to the type pill. */
  role: string | null;
  /** Status string for the row (active, blocked, invited, new, …). */
  status: string | null;
  /** True if currently blocked (banned auth user OR blocked_until > now). */
  blocked: boolean;
  /** ISO timestamp; null = not blocked, far-future = permanent block. */
  blocked_until: string | null;
  /** When the contact account was created. */
  created_at: string | null;
  /** Last sign-in for auth-backed contacts (couples, admin team). */
  last_active_at: string | null;
  /** Optional id of the venue this contact is associated with. */
  venue_id: string | null;
  /** Human-readable venue name when relevant. */
  venue_name: string | null;
  /** Whether the admin can open a "Login as" session for this contact. */
  can_impersonate: boolean;
  /** Whether the admin can reset a password for this contact. */
  can_reset_password: boolean;
}

function asStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function blockedNow(blocked_until: string | null): boolean {
  if (!blocked_until) return false;
  const t = Date.parse(blocked_until);
  if (Number.isNaN(t)) return false;
  return t > Date.now();
}

// ── venue owners ────────────────────────────────────────────────────────────

async function loadVenueOwners(): Promise<AdminContact[]> {
  // Owner identity lives on the venues row itself (email, phone, etc.). We
  // also pull blocked_until/admin_notes when those columns exist (migration
  // 138). Older schemas don't have them — guard with a re-try.
  type VenueRow = Record<string, unknown> & { id: string };
  let venues: VenueRow[] = [];
  {
    const { data, error } = await supabaseAdmin
      .from('venues')
      .select(
        'id, name, email, phone, notification_phone, owner_first_name, owner_last_name, location_city, location_state, created_at, onboarding_status, setup_completed, is_demo, blocked_until, blocked_reason, owner_id',
      )
      .order('created_at', { ascending: false });
    if (error && /blocked_until|blocked_reason/i.test(error.message)) {
      const retry = await supabaseAdmin
        .from('venues')
        .select(
          'id, name, email, phone, notification_phone, owner_first_name, owner_last_name, location_city, location_state, created_at, onboarding_status, setup_completed, is_demo, owner_id',
        )
        .order('created_at', { ascending: false });
      if (retry.error) throw retry.error;
      venues = (retry.data ?? []) as VenueRow[];
    } else if (error) {
      throw error;
    } else {
      venues = (data ?? []) as VenueRow[];
    }
  }

  return venues.map((v) => {
    const blocked_until = asStr(v.blocked_until);
    return {
      type: 'venue_owner',
      id: v.id,
      first_name: asStr(v.owner_first_name),
      last_name:  asStr(v.owner_last_name),
      display_name: asStr(v.name),
      email: asStr(v.email),
      phone: asStr(v.phone) ?? asStr(v.notification_phone),
      city: asStr(v.location_city),
      state: asStr(v.location_state),
      role: v.is_demo === true ? 'Demo venue' : 'Owner',
      status: asStr(v.onboarding_status) ?? (v.setup_completed ? 'active' : 'pending'),
      blocked: blockedNow(blocked_until),
      blocked_until,
      created_at: asStr(v.created_at),
      last_active_at: null,
      venue_id: v.id,
      venue_name: asStr(v.name),
      can_impersonate: true,
      can_reset_password: true,
    } satisfies AdminContact;
  });
}

// ── couples / brides ────────────────────────────────────────────────────────

async function loadCouples(): Promise<AdminContact[]> {
  type ProfileRow = Record<string, unknown> & { id: string };
  let profiles: ProfileRow[] = [];
  {
    const sel = 'id, first_name, last_name, display_name, phone, city, state, wedding_date, blocked_until, created_at';
    const initial = await supabaseAdmin
      .from('couple_profiles')
      .select(sel)
      .order('created_at', { ascending: false });
    if (initial.error && /first_name|last_name|blocked_until/i.test(initial.error.message)) {
      const retry = await supabaseAdmin
        .from('couple_profiles')
        .select('id, display_name, phone, city, state, wedding_date, created_at')
        .order('created_at', { ascending: false });
      if (retry.error) throw retry.error;
      profiles = (retry.data ?? []) as ProfileRow[];
    } else if (initial.error) {
      throw initial.error;
    } else {
      profiles = (initial.data ?? []) as ProfileRow[];
    }
  }
  if (profiles.length === 0) return [];

  const profileById = new Map<string, ProfileRow>();
  for (const p of profiles) profileById.set(p.id, p);

  const out: AdminContact[] = [];
  let page = 1;
  const perPage = 1000;
  while (out.length < profiles.length) {
    const { data: authResp, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) break;
    const users = authResp?.users ?? [];
    if (users.length === 0) break;

    for (const u of users) {
      const p = profileById.get(u.id);
      if (!p) continue;
      const blocked_until = asStr(p.blocked_until) ?? (u.banned_until ?? null);
      out.push({
        type: 'couple',
        id: u.id,
        first_name: asStr(p.first_name),
        last_name: asStr(p.last_name),
        display_name: asStr(p.display_name),
        email: asStr(u.email),
        phone: asStr(p.phone),
        city: asStr(p.city),
        state: asStr(p.state),
        role: 'Couple',
        status: u.email_confirmed_at ? 'active' : 'unconfirmed',
        blocked: blockedNow(blocked_until),
        blocked_until,
        created_at: asStr(p.created_at) ?? asStr(u.created_at),
        last_active_at: asStr(u.last_sign_in_at),
        venue_id: null,
        venue_name: null,
        can_impersonate: true,
        can_reset_password: true,
      });
    }
    if (users.length < perPage) break;
    page += 1;
  }
  return out;
}

// ── venue team members ─────────────────────────────────────────────────────

async function loadVenueTeam(): Promise<AdminContact[]> {
  type TeamRow = Record<string, unknown> & { id: string; venue_id: string };
  let rows: TeamRow[] = [];
  {
    const sel = 'id, venue_id, first_name, last_name, name, email, phone, role, status, blocked_until, created_at';
    const initial = await supabaseAdmin
      .from('venue_team_members')
      .select(sel)
      .order('created_at', { ascending: false });
    if (initial.error && /phone|blocked_until/i.test(initial.error.message)) {
      const retry = await supabaseAdmin
        .from('venue_team_members')
        .select('id, venue_id, first_name, last_name, name, email, role, status, created_at')
        .order('created_at', { ascending: false });
      if (retry.error) throw retry.error;
      rows = (retry.data ?? []) as TeamRow[];
    } else if (initial.error) {
      // Table may not exist at all on minimal schemas
      if (/relation .* does not exist|schema cache/i.test(initial.error.message)) return [];
      throw initial.error;
    } else {
      rows = (initial.data ?? []) as TeamRow[];
    }
  }
  if (rows.length === 0) return [];

  // Resolve venue names for nicer display
  const venueIds = Array.from(new Set(rows.map((r) => r.venue_id).filter(Boolean) as string[]));
  let venueNameById = new Map<string, string>();
  if (venueIds.length) {
    const { data: venues } = await supabaseAdmin
      .from('venues')
      .select('id, name')
      .in('id', venueIds);
    venueNameById = new Map((venues ?? []).map((v) => [v.id as string, (v.name as string) ?? '']));
  }

  return rows.map((r) => {
    const blocked_until = asStr(r.blocked_until);
    const status = asStr(r.status);
    return {
      type: 'venue_team',
      id: r.id,
      first_name: asStr(r.first_name),
      last_name: asStr(r.last_name),
      display_name: asStr(r.name),
      email: asStr(r.email),
      phone: asStr(r.phone),
      city: null,
      state: null,
      role: asStr(r.role),
      status: status ?? 'invited',
      blocked: blockedNow(blocked_until) || status === 'blocked',
      blocked_until,
      created_at: asStr(r.created_at),
      last_active_at: null,
      venue_id: r.venue_id ?? null,
      venue_name: venueNameById.get(r.venue_id) ?? null,
      can_impersonate: false,
      can_reset_password: false,
    } satisfies AdminContact;
  });
}

// ── support / admin team members ───────────────────────────────────────────

async function loadAdminTeam(): Promise<AdminContact[]> {
  type SupportRow = Record<string, unknown> & { id: string };
  let rows: SupportRow[] = [];
  {
    const sel = 'id, email, name, first_name, last_name, phone, role, active, last_login_at, created_at, is_super_admin';
    const initial = await supabaseAdmin
      .from('support_team_members')
      .select(sel)
      .order('created_at', { ascending: false });
    if (initial.error && /phone|first_name|last_name|is_super_admin/i.test(initial.error.message)) {
      const retry = await supabaseAdmin
        .from('support_team_members')
        .select('id, email, name, role, active, last_login_at, created_at')
        .order('created_at', { ascending: false });
      if (retry.error) throw retry.error;
      rows = (retry.data ?? []) as SupportRow[];
    } else if (initial.error) {
      if (/relation .* does not exist/i.test(initial.error.message)) return [];
      throw initial.error;
    } else {
      rows = (initial.data ?? []) as SupportRow[];
    }
  }

  // Hide synthetic super-admin row used for FK attribution only
  return rows
    .filter((r) => !String(r.email ?? '').endsWith('@storyvenue.internal'))
    .map((r) => ({
      type: 'admin_team' as const,
      id: r.id,
      first_name: asStr(r.first_name),
      last_name: asStr(r.last_name),
      display_name: asStr(r.name),
      email: asStr(r.email),
      phone: asStr(r.phone),
      city: null,
      state: null,
      role: r.is_super_admin === true ? 'Super admin' : (asStr(r.role) ?? 'support_agent'),
      status: r.active === false ? 'inactive' : 'active',
      blocked: r.active === false,
      blocked_until: null,
      created_at: asStr(r.created_at),
      last_active_at: asStr(r.last_login_at),
      venue_id: null,
      venue_name: null,
      can_impersonate: false,
      can_reset_password: true,
    }));
}

// ── directory leads ────────────────────────────────────────────────────────

async function loadLeads(): Promise<AdminContact[]> {
  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('id, venue_id, name, email, phone, status, wedding_date, source, created_at')
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return [];
    throw error;
  }
  const rows = (data ?? []) as Array<Record<string, unknown> & { id: string }>;
  if (rows.length === 0) return [];

  const venueIds = Array.from(new Set(rows.map((r) => r.venue_id).filter(Boolean) as string[]));
  let venueNameById = new Map<string, string>();
  if (venueIds.length) {
    const { data: venues } = await supabaseAdmin
      .from('venues')
      .select('id, name')
      .in('id', venueIds);
    venueNameById = new Map((venues ?? []).map((v) => [v.id as string, (v.name as string) ?? '']));
  }

  return rows.map((r) => {
    const fullName = asStr(r.name);
    const [first = null, ...rest] = (fullName ?? '').trim().split(/\s+/);
    return {
      type: 'lead' as const,
      id: r.id,
      first_name: first || null,
      last_name: rest.length ? rest.join(' ') : null,
      display_name: fullName,
      email: asStr(r.email),
      phone: asStr(r.phone),
      city: null,
      state: null,
      role: asStr(r.source) ?? 'directory',
      status: asStr(r.status) ?? 'new',
      blocked: false,
      blocked_until: null,
      created_at: asStr(r.created_at),
      last_active_at: null,
      venue_id: (r.venue_id as string | null) ?? null,
      venue_name: venueNameById.get(r.venue_id as string) ?? null,
      can_impersonate: false,
      can_reset_password: false,
    };
  });
}

// ── waitlist ───────────────────────────────────────────────────────────────

async function loadWaitlist(): Promise<AdminContact[]> {
  const { data, error } = await supabaseAdmin
    .from('waitlist')
    .select('id, first_name, last_name, email, phone, venue_name, referral_source, created_at')
    .order('created_at', { ascending: false });
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) return [];
    throw error;
  }
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown> & { id: string };
    return {
      type: 'waitlist' as const,
      id: row.id,
      first_name: asStr(row.first_name),
      last_name: asStr(row.last_name),
      display_name: [asStr(row.first_name), asStr(row.last_name)].filter(Boolean).join(' ') || null,
      email: asStr(row.email),
      phone: asStr(row.phone),
      city: null,
      state: null,
      role: asStr(row.referral_source) ?? 'waitlist',
      status: 'waitlist',
      blocked: false,
      blocked_until: null,
      created_at: asStr(row.created_at),
      last_active_at: null,
      venue_id: null,
      venue_name: asStr(row.venue_name),
      can_impersonate: false,
      can_reset_password: false,
    };
  });
}

/**
 * Load every contact across every source. Each loader is best-effort: an
 * outage on one (missing table, RLS rule etc.) won't take down the whole
 * Contacts page.
 */
export async function loadAllContacts(opts: { types?: ContactType[] } = {}): Promise<{
  contacts: AdminContact[];
  errors: { type: ContactType; message: string }[];
}> {
  const want = new Set<ContactType>(opts.types?.length ? opts.types : CONTACT_TYPES);
  const errors: { type: ContactType; message: string }[] = [];
  const all: AdminContact[] = [];

  async function run(type: ContactType, fn: () => Promise<AdminContact[]>) {
    if (!want.has(type)) return;
    try {
      const rows = await fn();
      for (const r of rows) all.push(r);
    } catch (e) {
      errors.push({
        type,
        message: e instanceof Error ? e.message : String(e),
      });
      console.error(`[admin-contacts] ${type} load failed:`, e);
    }
  }

  // Parallelize the cheap reads.
  await Promise.all([
    run('venue_owner', loadVenueOwners),
    run('couple', loadCouples),
    run('venue_team', loadVenueTeam),
    run('admin_team', loadAdminTeam),
    run('lead', loadLeads),
    run('waitlist', loadWaitlist),
  ]);

  all.sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : 0;
    const tb = b.created_at ? Date.parse(b.created_at) : 0;
    return tb - ta;
  });

  return { contacts: all, errors };
}

/** Search-haystack helper kept centralized for parity between server and CSV exports. */
export function contactMatches(c: AdminContact, q: string): boolean {
  if (!q) return true;
  const hay = [
    c.first_name, c.last_name, c.display_name, c.email, c.phone,
    c.city, c.state, c.role, c.status, c.venue_name,
    CONTACT_TYPE_LABELS[c.type],
  ]
    .filter((v): v is string => Boolean(v))
    .map((v) => v.toLowerCase())
    .join(' ');
  return hay.includes(q.toLowerCase());
}
