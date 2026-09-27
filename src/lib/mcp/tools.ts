/**
 * The tools AI agents (Jarvis, …) get through the MCP server.
 *
 * All read-only. Results are compact JSON — they go straight into the model's
 * context — and lists are paginated (limit / offset, `next_offset` when there
 * is more). Counts are computed in SQL, so they're never capped by an API row
 * limit. Demo venues are left out unless a tool is asked to include them.
 *
 * Vocabulary (also in the server instructions):
 *   account = a venue (a StoryVenue customer). paying = subscription status
 *   'active'. lead = a couple's inquiry to a venue.
 */

import { readQuery, runAgentSql, AgentSqlError } from '@/lib/mcp/db';
import { loadAddonPrices } from '@/lib/venue-billing';
import { furthestStage, hasCardOnFile, FUNNEL_STAGES, venueStageReached, type VenueFunnelState } from '@/lib/funnel-stage';
import { leadSourceLabel } from '@/lib/lead-source';

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Args) => Promise<unknown>;
}

export class ToolInputError extends Error {}

// ── Small helpers ────────────────────────────────────────────────────────────

function int(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function bool(v: unknown): boolean {
  return v === true || v === 'true';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `%term%` for ILIKE, with LIKE wildcards in the term escaped. */
function like(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Dollars from cents, e.g. 14900 → 149. */
function dollars(cents: unknown): number {
  const n = Number(cents ?? 0);
  return Math.round(n) / 100;
}

function clip(s: unknown, max: number): string | null {
  if (s == null) return null;
  const v = String(s).replace(/\s+/g, ' ').trim();
  if (!v) return null;
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

/** Drop null / empty fields so rows stay short in the model's context. */
function lean<T extends Row>(row: T): Partial<T> {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined || v === '') continue;
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out as Partial<T>;
}

function page<T>(rows: T[], limit: number, offset: number, total?: number) {
  const hasMore = total !== undefined ? offset + rows.length < total : rows.length > limit;
  return {
    ...(total !== undefined ? { total } : {}),
    offset,
    returned: Math.min(rows.length, limit),
    ...(hasMore ? { next_offset: offset + limit } : {}),
  };
}

// ── Shared SQL ───────────────────────────────────────────────────────────────

/** Normalised subscription status of venue alias `v`. */
const STATUS = `lower(coalesce(nullif(trim(v.directory_subscription_status), ''), 'none'))`;

const NOT_DEMO = `coalesce(v.is_demo, false) = false`;

/** Monthly recurring revenue (cents) of venue `v` joined to plan `p`; 0 unless paying. */
async function mrrExpr(): Promise<string> {
  const a = await loadAddonPrices();
  const n = (x: unknown) => Math.max(0, Math.trunc(Number(x) || 0));
  return `(case when ${STATUS} = 'active' then
      coalesce(p.price_monthly_cents, 0)
      + (case when v.directory_addon_verified then ${n(a.verified_cents)} else 0 end)
      + (case when v.directory_addon_sponsored then ${n(a.sponsored_cents)} else 0 end)
      + (case when v.directory_addon_concierge then ${n(a.concierge_cents)} else 0 end)
    else 0 end)`;
}

/** Filter for the billing groups agents ask about. */
function billingFilter(status: string): string | null {
  switch (status) {
    case 'paying': return `${STATUS} = 'active'`;
    case 'trialing': return `${STATUS} = 'trialing'`;
    case 'past_due': return `${STATUS} = 'past_due'`;
    case 'canceled': return `${STATUS} in ('canceled', 'cancelled')`;
    case 'not_paying': return `${STATUS} <> 'active'`;
    case 'no_subscription': return `${STATUS} not in ('active', 'trialing', 'past_due', 'canceled', 'cancelled')`;
    case 'all':
    case '': return null;
    default: throw new ToolInputError(`Unknown billing_status "${status}".`);
  }
}

/** Find one account from an id, email, slug or name. */
async function findAccounts(query: string, includeDemo = true): Promise<Row[]> {
  const q = query.trim();
  if (!q) throw new ToolInputError('account is required (a venue id, email, slug or name).');
  const demo = includeDemo ? 'true' : NOT_DEMO;
  if (UUID.test(q)) return readQuery(`select v.id, v.name from venues v where v.id = $1`, [q]);
  const exact = await readQuery(
    `select v.id, v.name from venues v
      where ${demo} and (lower(v.email) = lower($1) or lower(v.slug) = lower($1)
         or lower(coalesce(v.notification_email, '')) = lower($1) or lower(v.name) = lower($1))
      limit 5`,
    [q],
  );
  if (exact.length) return exact;
  return readQuery(
    `select v.id, v.name, v.email from venues v
      where ${demo} and (v.name ilike $1 or v.email ilike $1 or v.slug ilike $1)
      order by v.last_login_at desc nulls last limit 8`,
    [like(q)],
  );
}

// ── Tools ────────────────────────────────────────────────────────────────────

const businessSnapshot: McpTool = {
  name: 'business_snapshot',
  description:
    'Start here for any big-picture question. One call returns the state of the business: accounts (venues) by billing status (paying, trialing, past due, canceled, no subscription), MRR, revenue collected in the last 30 days, signups, recent logins, published listings, and leads (7 days, 30 days, all time). Demo venues are excluded.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  async run() {
    const mrr = await mrrExpr();
    const [accounts, money, leads] = await Promise.all([
      readQuery(`
        select count(*)::int as accounts,
          count(*) filter (where ${STATUS} = 'active')::int as paying,
          count(*) filter (where ${STATUS} = 'trialing')::int as trialing,
          count(*) filter (where ${STATUS} = 'past_due')::int as past_due,
          count(*) filter (where ${STATUS} in ('canceled', 'cancelled'))::int as canceled,
          count(*) filter (where ${STATUS} not in ('active', 'trialing', 'past_due', 'canceled', 'cancelled'))::int as no_subscription,
          count(*) filter (where v.created_at > now() - interval '7 days')::int as signups_7d,
          count(*) filter (where v.created_at > now() - interval '30 days')::int as signups_30d,
          count(*) filter (where v.last_login_at > now() - interval '7 days')::int as logged_in_7d,
          count(*) filter (where v.last_login_at > now() - interval '30 days')::int as logged_in_30d,
          count(*) filter (where v.is_published)::int as published_listings
        from venues v where ${NOT_DEMO}`),
      readQuery(`
        select
          (select coalesce(sum(${mrr}), 0)::bigint from venues v
             left join directory_plans p on p.id = v.directory_plan_id where ${NOT_DEMO}) as mrr_cents,
          (select coalesce(sum(e.amount_cents), 0)::bigint from platform_billing_events e
             where e.amount_cents > 0 and e.occurred_at > now() - interval '30 days') as collected_30d_cents,
          (select count(*)::int from platform_billing_events e
             where e.amount_cents > 0 and e.occurred_at > now() - interval '30 days') as payments_30d`),
      readQuery(`
        select count(*) filter (where l.created_at > now() - interval '7 days')::int as leads_7d,
          count(*) filter (where l.created_at > now() - interval '30 days')::int as leads_30d,
          count(*)::int as leads_all_time
        from leads l join venues v on v.id = l.venue_id where ${NOT_DEMO}`),
    ]);
    const m = money[0] ?? {};
    return {
      as_of: new Date().toISOString(),
      accounts: accounts[0],
      revenue: {
        mrr_usd: dollars(m.mrr_cents),
        arr_usd: dollars(Number(m.mrr_cents ?? 0) * 12),
        collected_last_30d_usd: dollars(m.collected_30d_cents),
        payments_last_30d: m.payments_30d,
      },
      leads: leads[0],
    };
  },
};

const listAccounts: McpTool = {
  name: 'list_accounts',
  description:
    'List or search accounts (venues = StoryVenue customers) with plan, billing status, MRR, owner, location, last login and leads in the last 30 days. Use billing_status to answer "who is paying / not paying / trialing / past due / canceled". Paginated.',
  inputSchema: {
    type: 'object',
    properties: {
      search: { type: 'string', description: 'Part of the venue name, email, slug or owner name.' },
      billing_status: {
        type: 'string',
        enum: ['all', 'paying', 'not_paying', 'trialing', 'past_due', 'canceled', 'no_subscription'],
        description: 'Default all. paying = active subscription; not_paying = everything else.',
      },
      plan: { type: 'string', description: 'Plan name or slug, e.g. "Pro".' },
      signed_up_within_days: { type: 'number', description: 'Only accounts created in the last N days.' },
      sort: {
        type: 'string',
        enum: ['newest', 'oldest', 'name', 'mrr', 'last_login', 'leads_30d', 'trial_ends'],
        description: 'Default newest.',
      },
      include_demo: { type: 'boolean', description: 'Include demo venues (default false).' },
      limit: { type: 'number', description: '1-50, default 25.' },
      offset: { type: 'number', description: 'For the next page.' },
    },
    required: [],
  },
  async run(args) {
    const limit = int(args.limit, 25, 1, 50);
    const offset = int(args.offset, 0, 0, 1_000_000);
    const where: string[] = [];
    const params: unknown[] = [];
    const bind = (v: unknown) => { params.push(v); return `$${params.length}`; };

    if (!bool(args.include_demo)) where.push(NOT_DEMO);
    const bf = billingFilter(text(args.billing_status));
    if (bf) where.push(bf);
    const search = text(args.search);
    if (search) {
      const s = bind(like(search));
      where.push(`(v.name ilike ${s} or v.email ilike ${s} or v.slug ilike ${s}
        or concat_ws(' ', j->>'owner_first_name', j->>'owner_last_name') ilike ${s})`);
    }
    const plan = text(args.plan);
    if (plan) {
      const s = bind(like(plan));
      where.push(`(p.name ilike ${s} or p.slug ilike ${s})`);
    }
    if (args.signed_up_within_days !== undefined) {
      where.push(`v.created_at > now() - make_interval(days => ${bind(int(args.signed_up_within_days, 30, 1, 3650))})`);
    }
    const order: Record<string, string> = {
      newest: 'v.created_at desc',
      oldest: 'v.created_at asc',
      name: 'v.name asc',
      mrr: 'mrr_cents desc, v.name asc',
      last_login: 'v.last_login_at desc nulls last',
      leads_30d: 'leads_30d desc, v.name asc',
      trial_ends: 'v.directory_trial_ends_at asc nulls last',
    };
    const sort = order[text(args.sort) || 'newest'];
    if (!sort) throw new ToolInputError(`Unknown sort "${text(args.sort)}".`);

    const mrr = await mrrExpr();
    const rows = await readQuery(
      `select v.id, v.name, v.email,
          nullif(trim(concat_ws(' ', j->>'owner_first_name', j->>'owner_last_name')), '') as owner,
          nullif(concat_ws(', ', nullif(j->>'city', ''), nullif(coalesce(j->>'state', j->>'location_state'), '')), '') as location,
          p.name as plan, ${STATUS} as billing_status,
          v.directory_trial_ends_at as trial_ends_at,
          ${mrr} as mrr_cents,
          v.created_at, v.last_login_at, v.is_published, v.is_demo,
          coalesce(l30.n, 0)::int as leads_30d,
          count(*) over ()::int as total
        from venues v
        cross join lateral (select to_jsonb(v) as j) x
        left join directory_plans p on p.id = v.directory_plan_id
        left join (select venue_id, count(*) as n from leads
                    where created_at > now() - interval '30 days' group by venue_id) l30 on l30.venue_id = v.id
        ${where.length ? `where ${where.join(' and ')}` : ''}
        order by ${sort}
        limit ${bind(limit)} offset ${bind(offset)}`,
      params,
    );
    const total = Number(rows[0]?.total ?? 0);
    return {
      ...page(rows, limit, offset, rows.length ? total : offset),
      accounts: rows.map(({ total: _t, mrr_cents, is_demo, ...r }) => {
        void _t;
        return lean({ ...r, mrr_usd: Number(mrr_cents) ? dollars(mrr_cents) : null, demo: is_demo ? true : null });
      }),
    };
  },
};

const getAccount: McpTool = {
  name: 'get_account',
  description:
    'Everything about one account (venue): owner and contact details, plan and billing (status, trial end, add-ons, MRR, lifetime paid, recent payments), onboarding stage, team members, lead totals by source and the latest leads, and connected integrations. Look it up by venue id, email, slug or name.',
  inputSchema: {
    type: 'object',
    properties: { account: { type: 'string', description: 'Venue id, email, slug or (part of the) name.' } },
    required: ['account'],
  },
  async run(args) {
    const matches = await findAccounts(text(args.account));
    if (matches.length === 0) return { found: false, message: 'No account matches that.' };
    if (matches.length > 1) {
      return { found: false, message: 'Several accounts match; ask again with one of these ids.', matches: matches.map(lean) };
    }
    const id = String(matches[0].id);
    const mrr = await mrrExpr();

    const [venueRows, team, leadTotals, leadSources, latestLeads, billing, payments] = await Promise.all([
      readQuery(
        `select to_jsonb(v) as j, p.name as plan, p.price_monthly_cents as plan_price_cents,
            ${STATUS} as billing_status, ${mrr} as mrr_cents
           from venues v left join directory_plans p on p.id = v.directory_plan_id where v.id = $1`,
        [id],
      ),
      readQuery(`select to_jsonb(t) as j from venue_team_members t where t.venue_id = $1 order by 1 limit 50`, [id]).catch(() => []),
      readQuery(
        `select count(*)::int as all_time,
            count(*) filter (where created_at > now() - interval '30 days')::int as last_30d,
            count(*) filter (where created_at > now() - interval '7 days')::int as last_7d,
            max(created_at) as latest_at
           from leads where venue_id = $1`,
        [id],
      ),
      readQuery(
        `select coalesce(nullif(source, ''), 'other') as source, count(*)::int as n
           from leads where venue_id = $1 group by 1 order by 2 desc limit 10`,
        [id],
      ),
      readQuery(
        `select id, coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), name) as name,
            email, phone, source, referral_source, status, wedding_date::text as wedding_date, created_at
           from leads where venue_id = $1 order by created_at desc limit 5`,
        [id],
      ),
      readQuery(
        `select coalesce(sum(amount_cents) filter (where amount_cents > 0), 0)::bigint as lifetime_paid_cents,
            max(occurred_at) filter (where amount_cents > 0) as last_payment_at
           from platform_billing_events where venue_id = $1`,
        [id],
      ),
      readQuery(
        `select event_type, amount_cents, occurred_at from platform_billing_events
          where venue_id = $1 order by occurred_at desc limit 5`,
        [id],
      ),
    ]);

    const row = venueRows[0];
    if (!row) return { found: false, message: 'No account matches that.' };
    const j = (row.j ?? {}) as Record<string, unknown>;
    const g = (k: string) => (j[k] === undefined ? null : j[k]);
    const stage = furthestStage(j as VenueFunnelState);

    return {
      found: true,
      account: lean({
        id,
        name: g('name'),
        slug: g('slug'),
        email: g('email'),
        notification_email: g('notification_email'),
        phone: g('phone'),
        owner: clip([g('owner_first_name'), g('owner_last_name')].filter(Boolean).join(' '), 80),
        owner_phone: g('owner_phone'),
        website: g('brand_website') ?? g('website'),
        location: clip([g('address'), g('city'), g('state') ?? g('location_state'), g('zip')].filter(Boolean).join(', '), 160),
        created_at: g('created_at'),
        last_login_at: g('last_login_at'),
        published: g('is_published'),
        demo: g('is_demo') ? true : null,
        onboarding_stage: stage.label,
      }),
      billing: lean({
        plan: row.plan,
        plan_price_usd: row.plan_price_cents != null ? dollars(row.plan_price_cents) : null,
        status: row.billing_status,
        trial_ends_at: g('directory_trial_ends_at'),
        card_on_file: hasCardOnFile(j as VenueFunnelState),
        addons: [
          g('directory_addon_verified') ? 'verified' : null,
          g('directory_addon_sponsored') ? 'sponsored' : null,
          g('directory_addon_concierge') ? 'concierge' : null,
        ].filter(Boolean).join(', ') || null,
        mrr_usd: dollars(row.mrr_cents),
        lifetime_paid_usd: dollars(billing[0]?.lifetime_paid_cents),
        last_payment_at: billing[0]?.last_payment_at ?? null,
        recent_events: payments.map((p) => lean({ type: p.event_type, usd: dollars(p.amount_cents), at: p.occurred_at })),
      }),
      team: team.map((t) => {
        const m = (t.j ?? {}) as Record<string, unknown>;
        return lean({
          name: clip([m.first_name, m.last_name].filter(Boolean).join(' '), 80),
          email: m.email ?? null,
          role: m.role ?? null,
          status: m.status ?? null,
          added_at: m.created_at ?? null,
        });
      }),
      leads: {
        ...lean(leadTotals[0] ?? {}),
        by_source: leadSources.map((s) => ({ source: leadSourceLabel(String(s.source)), count: s.n })),
        latest: latestLeads.map((l) => lean({ ...l, source: leadSourceLabel(String(l.source ?? '')) })),
      },
      integrations: lean({
        ghl_connected: Boolean(g('ghl_location_id')) || null,
        leadfinder_inbox_copy: g('leadfinder_mirror_enabled'),
      }),
    };
  },
};

const revenueReport: McpTool = {
  name: 'revenue_report',
  description:
    'Money questions: MRR and paying accounts by plan, payments collected (and refunds) over the last N days, the latest payments, trials ending soon, and past-due accounts. Demo venues are excluded.',
  inputSchema: {
    type: 'object',
    properties: {
      days: { type: 'number', description: 'Look-back window for payments collected, default 30 (max 730).' },
      trial_window_days: { type: 'number', description: 'Trials ending within N days, default 14.' },
    },
    required: [],
  },
  async run(args) {
    const days = int(args.days, 30, 1, 730);
    const trialDays = int(args.trial_window_days, 14, 1, 90);
    const mrr = await mrrExpr();
    const [byPlan, collected, recent, trials, pastDue] = await Promise.all([
      readQuery(
        `select coalesce(p.name, 'No plan') as plan, count(*)::int as paying, sum(${mrr})::bigint as mrr_cents
           from venues v left join directory_plans p on p.id = v.directory_plan_id
          where ${NOT_DEMO} and ${STATUS} = 'active' group by 1 order by 3 desc`,
      ),
      readQuery(
        `select coalesce(sum(amount_cents) filter (where amount_cents > 0), 0)::bigint as collected_cents,
            count(*) filter (where amount_cents > 0)::int as payments,
            coalesce(-sum(amount_cents) filter (where amount_cents < 0), 0)::bigint as refunded_cents
           from platform_billing_events where occurred_at > now() - make_interval(days => $1)`,
        [days],
      ),
      readQuery(
        `select v.name as account, e.event_type, e.amount_cents, e.occurred_at
           from platform_billing_events e left join venues v on v.id = e.venue_id
          order by e.occurred_at desc limit 15`,
      ),
      readQuery(
        `select v.id, v.name, v.email, p.name as plan, v.directory_trial_ends_at as trial_ends_at
           from venues v left join directory_plans p on p.id = v.directory_plan_id
          where ${NOT_DEMO} and ${STATUS} = 'trialing'
            and v.directory_trial_ends_at between now() and now() + make_interval(days => $1)
          order by v.directory_trial_ends_at limit 50`,
        [trialDays],
      ),
      readQuery(
        `select v.id, v.name, v.email, p.name as plan, v.last_login_at
           from venues v left join directory_plans p on p.id = v.directory_plan_id
          where ${NOT_DEMO} and ${STATUS} = 'past_due' order by v.name limit 50`,
      ),
    ]);
    const totalMrr = byPlan.reduce((s, r) => s + Number(r.mrr_cents ?? 0), 0);
    const c = collected[0] ?? {};
    return {
      mrr_usd: dollars(totalMrr),
      paying_accounts: byPlan.reduce((s, r) => s + Number(r.paying ?? 0), 0),
      by_plan: byPlan.map((r) => ({ plan: r.plan, paying: r.paying, mrr_usd: dollars(r.mrr_cents) })),
      [`last_${days}_days`]: {
        collected_usd: dollars(c.collected_cents),
        payments: c.payments,
        refunded_usd: dollars(c.refunded_cents),
      },
      latest_payments: recent.map((r) => lean({ account: r.account, type: r.event_type, usd: dollars(r.amount_cents), at: r.occurred_at })),
      [`trials_ending_next_${trialDays}_days`]: trials.map(lean),
      past_due_accounts: pastDue.map(lean),
    };
  },
};

const listPeople: McpTool = {
  name: 'list_people',
  description:
    'People with access to StoryVenue: venue owners and their team members, with the venue they belong to, contact details and last login. Search by name or email. Paginated.',
  inputSchema: {
    type: 'object',
    properties: {
      search: { type: 'string', description: 'Part of a name or email.' },
      role: { type: 'string', enum: ['all', 'owner', 'team'], description: 'Default all.' },
      include_demo: { type: 'boolean', description: 'Include demo venues (default false).' },
      limit: { type: 'number', description: '1-50, default 25.' },
      offset: { type: 'number' },
    },
    required: [],
  },
  async run(args) {
    const limit = int(args.limit, 25, 1, 50);
    const offset = int(args.offset, 0, 0, 1_000_000);
    const role = text(args.role) || 'all';
    if (!['all', 'owner', 'team'].includes(role)) throw new ToolInputError(`Unknown role "${role}".`);
    const params: unknown[] = [];
    const bind = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const demo = bool(args.include_demo) ? 'true' : NOT_DEMO;
    const search = text(args.search);
    const s = search ? bind(like(search)) : null;

    const owners = `
      select 'owner' as role, v.id as venue_id, v.name as venue,
          nullif(trim(concat_ws(' ', j->>'owner_first_name', j->>'owner_last_name')), '') as name,
          v.email, coalesce(nullif(j->>'owner_phone', ''), v.phone) as phone,
          v.last_login_at as last_login_at, v.created_at as added_at
        from venues v cross join lateral (select to_jsonb(v) as j) x where ${demo}`;
    const team = `
      select coalesce(nullif(t.j->>'role', ''), 'team') as role, v.id as venue_id, v.name as venue,
          nullif(trim(concat_ws(' ', t.j->>'first_name', t.j->>'last_name')), '') as name,
          t.j->>'email' as email, t.j->>'phone' as phone,
          (t.j->>'last_login_at')::timestamptz as last_login_at, (t.j->>'created_at')::timestamptz as added_at
        from (select to_jsonb(m) as j from venue_team_members m) t
        join venues v on v.id = (t.j->>'venue_id')::uuid where ${demo}`;
    const union = role === 'owner' ? owners : role === 'team' ? team : `${owners} union all ${team}`;
    const rows = await readQuery(
      `select *, count(*) over ()::int as total from (${union}) people
        ${s ? `where name ilike ${s} or email ilike ${s} or venue ilike ${s}` : ''}
        order by added_at desc nulls last
        limit ${bind(limit)} offset ${bind(offset)}`,
      params,
    );
    const total = Number(rows[0]?.total ?? 0);
    return {
      ...page(rows, limit, offset, rows.length ? total : offset),
      people: rows.map(({ total: _t, ...r }) => { void _t; return lean(r); }),
    };
  },
};

const searchLeads: McpTool = {
  name: 'search_leads',
  description:
    'Find leads (couples who inquired with a venue) across all accounts: by name, email or phone, by account, source (e.g. leadfinder, directory, form, lead_link, embed, manual), status, or how recent. Returns the lead, its venue, source, wedding date, guests and a short message. Paginated, newest first.',
  inputSchema: {
    type: 'object',
    properties: {
      search: { type: 'string', description: 'Part of the couple\'s name, email or phone.' },
      account: { type: 'string', description: 'Venue id, email, slug or name to limit to one account.' },
      source: { type: 'string', description: 'Raw lead source, e.g. leadfinder, directory, form, lead_link, embed, manual.' },
      status: { type: 'string', description: 'Lead status, e.g. new, contacted, booked, lost.' },
      days: { type: 'number', description: 'Only leads created in the last N days.' },
      include_demo: { type: 'boolean', description: 'Include demo venues (default false).' },
      limit: { type: 'number', description: '1-50, default 25.' },
      offset: { type: 'number' },
    },
    required: [],
  },
  async run(args) {
    const limit = int(args.limit, 25, 1, 50);
    const offset = int(args.offset, 0, 0, 1_000_000);
    const where: string[] = [];
    const params: unknown[] = [];
    const bind = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (!bool(args.include_demo)) where.push(NOT_DEMO);

    const account = text(args.account);
    if (account) {
      const found = await findAccounts(account);
      if (found.length !== 1) {
        return found.length
          ? { message: 'Several accounts match; ask again with one of these ids.', matches: found.map(lean) }
          : { message: 'No account matches that.' };
      }
      where.push(`l.venue_id = ${bind(found[0].id)}`);
    }
    const search = text(args.search);
    if (search) {
      const s = bind(like(search));
      const digits = search.replace(/\D/g, '');
      where.push(`(l.name ilike ${s} or l.email ilike ${s} or concat_ws(' ', l.first_name, l.last_name) ilike ${s}
        ${digits.length >= 4 ? `or regexp_replace(coalesce(l.phone, ''), '\\D', '', 'g') like ${bind(`%${digits}%`)}` : ''})`);
    }
    const source = text(args.source);
    if (source) where.push(`lower(l.source) = lower(${bind(source)})`);
    const status = text(args.status);
    if (status) where.push(`lower(l.status) = lower(${bind(status)})`);
    if (args.days !== undefined) where.push(`l.created_at > now() - make_interval(days => ${bind(int(args.days, 30, 1, 3650))})`);

    const rows = await readQuery(
      `select l.id, coalesce(nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''), l.name) as name,
          l.email, l.phone, v.name as account, l.source, l.referral_source, l.status,
          l.wedding_date::text as wedding_date, l.guest_count, l.message, l.created_at,
          count(*) over ()::int as total
        from leads l join venues v on v.id = l.venue_id
        ${where.length ? `where ${where.join(' and ')}` : ''}
        order by l.created_at desc
        limit ${bind(limit)} offset ${bind(offset)}`,
      params,
    );
    const total = Number(rows[0]?.total ?? 0);
    return {
      ...page(rows, limit, offset, rows.length ? total : offset),
      leads: rows.map(({ total: _t, message, source: src, ...r }) => {
        void _t;
        return lean({ ...r, source: leadSourceLabel(String(src ?? '')), message: clip(message, 200) });
      }),
    };
  },
};

const leadStats: McpTool = {
  name: 'lead_stats',
  description:
    'Lead volume over the last N days: total, by source, top accounts, and per day (for windows up to 90 days), plus the all-time total. Demo venues are excluded.',
  inputSchema: {
    type: 'object',
    properties: { days: { type: 'number', description: 'Look-back window, default 30 (max 365).' } },
    required: [],
  },
  async run(args) {
    const days = int(args.days, 30, 1, 365);
    const base = `from leads l join venues v on v.id = l.venue_id where ${NOT_DEMO}`;
    const inWindow = `and l.created_at > now() - make_interval(days => $1)`;
    const [totals, bySource, byAccount, byDay] = await Promise.all([
      readQuery(`select count(*) filter (where l.created_at > now() - make_interval(days => $1))::int as in_period,
                   count(*)::int as all_time ${base}`, [days]),
      readQuery(`select coalesce(nullif(l.source, ''), 'other') as source, count(*)::int as n ${base} ${inWindow}
                  group by 1 order by 2 desc`, [days]),
      readQuery(`select v.name as account, count(*)::int as n ${base} ${inWindow}
                  group by v.id, v.name order by 2 desc limit 15`, [days]),
      days <= 90
        ? readQuery(`select (l.created_at at time zone 'America/New_York')::date::text as day, count(*)::int as n
                      ${base} ${inWindow} group by 1 order by 1`, [days])
        : Promise.resolve([] as Row[]),
    ]);
    return {
      period_days: days,
      ...totals[0],
      by_source: bySource.map((r) => ({ source: leadSourceLabel(String(r.source)), count: r.n })),
      top_accounts: byAccount.map((r) => ({ account: r.account, count: r.n })),
      ...(byDay.length ? { per_day_eastern: byDay.map((r) => [r.day, r.n]) } : {}),
    };
  },
};

const signupFunnel: McpTool = {
  name: 'signup_funnel',
  description:
    'The venue signup funnel: how many accounts reached each onboarding stage (signed up → started → wrote their guide → sent a test inquiry → saw the card step → added a card → paid), with step conversion rates. Optional window by signup date.',
  inputSchema: {
    type: 'object',
    properties: { signed_up_within_days: { type: 'number', description: 'Only accounts created in the last N days (default: all time).' } },
    required: [],
  },
  async run(args) {
    const params: unknown[] = [];
    let window = '';
    if (args.signed_up_within_days !== undefined) {
      params.push(int(args.signed_up_within_days, 30, 1, 3650));
      window = `and v.created_at > now() - make_interval(days => $1)`;
    }
    const rows = await readQuery(
      `select v.id, v.is_published, v.onboarding_last_step, v.onboarding_completed_at, v.onboarding_activated_at,
          v.directory_subscription_status, v.directory_subscription_external_id,
          (to_jsonb(v)->>'directory_card_on_file')::boolean as directory_card_on_file
        from venues v where ${NOT_DEMO} ${window}`,
      params,
    );
    const counts: Record<string, number> = Object.fromEntries(FUNNEL_STAGES.map((s) => [s.key, 0]));
    for (const r of rows) {
      const reached = venueStageReached(r as VenueFunnelState);
      for (const s of FUNNEL_STAGES) if (reached[s.key]) counts[s.key] += 1;
    }
    const first = counts.signed_up || 1;
    return {
      accounts: rows.length,
      stages: FUNNEL_STAGES.map((s, i) => {
        const prev = i ? counts[FUNNEL_STAGES[i - 1].key] : counts[s.key];
        return {
          stage: s.label,
          count: counts[s.key],
          pct_of_signups: Math.round((counts[s.key] / first) * 100),
          step_conversion_pct: prev ? Math.round((counts[s.key] / prev) * 100) : 0,
        };
      }),
    };
  },
};

const unreadConversations: McpTool = {
  name: 'unread_conversations',
  description:
    'Conversations from the last 90 days where the couple sent the last message (waiting on the venue), newest first, with the account name and a preview.',
  inputSchema: {
    type: 'object',
    properties: {
      account: { type: 'string', description: 'Limit to one account (venue id, email, slug or name).' },
      limit: { type: 'number', description: '1-50, default 20.' },
    },
    required: [],
  },
  async run(args) {
    const limit = int(args.limit, 20, 1, 50);
    const params: unknown[] = [limit];
    let scope = '';
    const account = text(args.account);
    if (account) {
      const found = await findAccounts(account);
      if (found.length !== 1) {
        return found.length
          ? { message: 'Several accounts match; ask again with one of these ids.', matches: found.map(lean) }
          : { message: 'No account matches that.' };
      }
      params.push(found[0].id);
      scope = `and t.venue_id = $2`;
    }
    const rows = await readQuery(
      `select t.id as thread_id, v.name as account, t.subject, t.last_message_at, t.last_message_preview as preview
         from conversation_threads t
         join venues v on v.id = t.venue_id
         cross join lateral (select m.sender_kind from conversation_messages m
                              where m.thread_id = t.id order by m.created_at desc limit 1) last
        where ${NOT_DEMO} and last.sender_kind = 'contact' ${scope}
          and t.last_message_at > now() - interval '90 days'
        order by t.last_message_at desc nulls last
        limit $1`,
      params,
    );
    return { count: rows.length, conversations: rows.map((r) => lean({ ...r, preview: clip(r.preview, 200) })) };
  },
};

const listTables: McpTool = {
  name: 'list_tables',
  description:
    'The database tables run_sql can read, with approximate row counts. Use it (and describe_table) before writing SQL for a question the other tools don\'t cover.',
  inputSchema: {
    type: 'object',
    properties: { search: { type: 'string', description: 'Part of a table name, e.g. "lead" or "billing".' } },
    required: [],
  },
  async run(args) {
    const search = text(args.search);
    const params: unknown[] = [];
    const filter = search ? (params.push(like(search)), `and c.relname ilike $1`) : '';
    const rows = await readQuery(
      `select c.relname as table, greatest(c.reltuples, 0)::bigint as approx_rows,
          case c.relkind when 'v' then 'view' when 'm' then 'view' else null end as kind,
          obj_description(c.oid, 'pg_class') as about
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
          and c.relname not in ('mcp_api_keys', 'mcp_audit_log')
          and has_any_column_privilege('mcp_readonly', c.oid, 'SELECT') ${filter}
        order by c.relname`,
      params,
    );
    return { count: rows.length, tables: rows.map((r) => lean({ ...r, approx_rows: Number(r.approx_rows), about: clip(r.about, 120) })) };
  },
};

const describeTable: McpTool = {
  name: 'describe_table',
  description:
    'Columns (name, type, nullable) of one table that run_sql can read, plus the tables it links to. Secret columns (tokens, passwords, keys) are hidden and not queryable.',
  inputSchema: {
    type: 'object',
    properties: { table: { type: 'string', description: 'Table name, e.g. "leads".' } },
    required: ['table'],
  },
  async run(args) {
    const table = text(args.table).replace(/^public\./i, '');
    if (!table) throw new ToolInputError('table is required.');
    const [cols, fks, hidden] = await Promise.all([
      readQuery(
        `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, not a.attnotnull as nullable,
            col_description(a.attrelid, a.attnum) as about
           from pg_attribute a
           join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = $1 and a.attnum > 0 and not a.attisdropped
            and has_column_privilege('mcp_readonly', c.oid, a.attnum, 'SELECT')
          order by a.attnum`,
        [table],
      ),
      readQuery(
        `select pg_get_constraintdef(k.oid) as fk
           from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = $1 and k.contype = 'f'`,
        [table],
      ),
      readQuery(
        `select count(*)::int as n
           from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = $1 and a.attnum > 0 and not a.attisdropped
            and not has_column_privilege('mcp_readonly', c.oid, a.attnum, 'SELECT')`,
        [table],
      ),
    ]);
    if (!cols.length) return { found: false, message: `No readable table named "${table}". Use list_tables.` };
    return {
      table,
      columns: cols.map((c) => lean({ name: c.name, type: c.type, nullable: c.nullable ? null : false, about: clip(c.about, 120) })),
      links: fks.map((f) => f.fk),
      ...(Number(hidden[0]?.n) ? { hidden_secret_columns: Number(hidden[0].n) } : {}),
    };
  },
};

const runSql: McpTool = {
  name: 'run_sql',
  description:
    'Run ONE read-only PostgreSQL SELECT (or WITH … SELECT) against the StoryVenue database for anything the other tools don\'t answer. Check list_tables / describe_table first. Aggregate in SQL (count, sum, group by) instead of pulling raw rows. Results are paginated (limit / offset); timestamps are UTC; money columns ending in _cents are cents. Writes, secret columns and more than one statement are refused; queries time out after 25 seconds.',
  inputSchema: {
    type: 'object',
    properties: {
      sql: { type: 'string', description: 'A single SELECT / WITH query. No semicolons.' },
      limit: { type: 'number', description: 'Rows to return, 1-200, default 50.' },
      offset: { type: 'number', description: 'Rows to skip, for the next page.' },
    },
    required: ['sql'],
  },
  async run(args) {
    const limit = int(args.limit, 50, 1, 200);
    const offset = int(args.offset, 0, 0, 10_000_000);
    const res = await runAgentSql(text(args.sql), limit, offset);
    // Keep the answer small enough for the model: long text is clipped and the
    // row list is cut if the whole result grows past ~60 KB.
    let rows = res.rows.map((r) => {
      const o: Row = {};
      for (const [k, v] of Object.entries(r)) {
        o[k] = v instanceof Date ? v.toISOString()
          : typeof v === 'string' && v.length > 1000 ? `${v.slice(0, 999)}…`
          : typeof v === 'bigint' ? v.toString()
          : v;
      }
      return o;
    });
    let cut = false;
    while (rows.length > 1 && JSON.stringify(rows).length > 60_000) {
      rows = rows.slice(0, Math.ceil(rows.length / 2));
      cut = true;
    }
    return {
      columns: res.columns,
      offset,
      returned: rows.length,
      ...(cut || res.hasMore ? { next_offset: offset + rows.length } : {}),
      ...(cut ? { note: 'Result was large, so fewer rows were returned. Page with next_offset or aggregate in SQL.' } : {}),
      rows,
    };
  },
};

export const AGENT_TOOLS: McpTool[] = [
  businessSnapshot,
  listAccounts,
  getAccount,
  revenueReport,
  listPeople,
  searchLeads,
  leadStats,
  signupFunnel,
  unreadConversations,
  listTables,
  describeTable,
  runSql,
];

export { AgentSqlError };
