/**
 * Shared kit for the flow tests: they run whole business flows against the
 * test copy (never the live site) and check the results in its database and
 * outbox. Everything here refuses to run outside the test copy.
 */

import { createHmac } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const LIVE_SUPABASE_REF = 'brnxhsaakmhgwcthcapd';

function readEnv() {
  const e = process.env;
  const base = (e.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
  const supabaseUrl = e.NEXT_PUBLIC_SUPABASE_URL || '';
  if (e.APP_ENV !== 'staging' || !base || !supabaseUrl || supabaseUrl.includes(LIVE_SUPABASE_REF) || /storyvenue\.com/.test(base)) {
    throw new Error('Flow tests run only against the test copy: railway run --service "StoryVenue Backend" --environment Dev -- npm run test:flows');
  }
  return {
    base,
    stagingKey: e.STAGING_PASSWORD || '',
    password: e.STAGING_PASSWORD || '',
    supabaseUrl,
    serviceKey: e.SUPABASE_SERVICE_ROLE_KEY || '',
    leadSecret: e.LEAD_WEBHOOK_SECRET || '',
    cronSecret: e.MARKETING_CRON_SECRET || e.CRON_SECRET || '',
  };
}

export const env = readEnv();

/** The test copy's database, with full access (service role). */
export const db = createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false } });

/** A short id for this run, so each run's leads and emails are its own. */
export const runId = Date.now().toString(36);

/** An HTTP client that keeps cookies, like a browser tab, past the test copy's password page. */
export class Browser {
  private jar = new Map<string, string>();

  async fetch(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('x-staging-key', env.stagingKey);
    if (this.jar.size) headers.set('cookie', [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '));
    let body = init.body;
    if (init.json !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(init.json);
    }
    const res = await fetch(env.base + path, { ...init, headers, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (value) this.jar.set(name, value);
      else this.jar.delete(name);
    }
    return res;
  }

  async signIn(email: string, password = env.password): Promise<void> {
    const res = await this.fetch('/api/auth/sign-in', { method: 'POST', json: { email, password } });
    if (!res.ok) throw new Error(`sign-in failed for ${email}: ${res.status} ${await res.text()}`);
  }
}

let ownerSession: Promise<Browser> | null = null;

/**
 * The flow venue's owner, signed in once per run and shared: sign-in allows 5
 * attempts a minute per account, so tests don't each sign in again.
 */
export function signedInOwner(): Promise<Browser> {
  return (ownerSession ??= (async () => {
    await ensureFlowVenue();
    const b = new Browser();
    await b.signIn(FLOW_VENUE.email);
    return b;
  })());
}

/** Submit a lead exactly as the directory site does: signed with the shared secret. */
export async function submitListingLead(payload: Record<string, unknown>, opts: { sign?: boolean } = {}): Promise<Response> {
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-staging-key': env.stagingKey };
  if (opts.sign !== false) headers['x-storypay-signature'] = createHmac('sha256', env.leadSecret).update(raw).digest('hex');
  return fetch(`${env.base}/api/public/leads`, { method: 'POST', headers, body: raw });
}

export interface OutboxEmail { at: string; to: string[]; cc: string[]; subject: string; html: string; delivered: boolean }

export async function outbox(filter: { to?: string; since?: string } = {}): Promise<OutboxEmail[]> {
  const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]);
  const res = await fetch(`${env.base}/api/staging/outbox?${q}`, { headers: { 'x-staging-key': env.stagingKey } });
  if (!res.ok) throw new Error(`outbox: ${res.status}`);
  return ((await res.json()) as { emails: OutboxEmail[] }).emails;
}

/** Wait for an email to show up in the outbox (some are sent in the background). */
export async function waitForEmail(filter: { to?: string; since?: string }, match: (e: OutboxEmail) => boolean, timeoutMs = 25_000): Promise<OutboxEmail> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const found = (await outbox(filter)).find(match);
    if (found) return found;
    if (Date.now() > until) {
      const seen = (await outbox(filter)).map((e) => `"${e.subject}" → ${e.to.join(', ')}`);
      throw new Error(`No matching email within ${timeoutMs / 1000}s. Seen: ${seen.join(' | ') || 'none'}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** The venue the flow tests use: everything about it is fake (example.com addresses). */
export const FLOW_VENUE = {
  id: 'a7f10000-0000-4000-8000-000000000001',
  name: 'Flow Test Venue',
  slug: 'flow-test-venue',
  email: 'flow-owner@example.com',
};

export async function ensureFlowVenue(): Promise<void> {
  const { data: plan } = await db.from('directory_plans').select('id').eq('slug', 'bride-booking-system').single();
  const { error } = await db.from('venues').upsert({
    id: FLOW_VENUE.id,
    name: FLOW_VENUE.name,
    slug: FLOW_VENUE.slug,
    email: FLOW_VENUE.email,
    notification_email: FLOW_VENUE.email,
    brand_email: FLOW_VENUE.email,
    password_hash: await bcrypt.hash(env.password, 10),
    setup_completed: true,
    onboarding_status: 'registered',
    onboarding_completed_at: new Date().toISOString(),
    directory_plan_id: plan?.id ?? null,
    directory_subscription_status: 'active',
    email_verified_at: new Date().toISOString(),
    owner_first_name: 'Flow',
    owner_last_name: 'Owner',
    location_city: 'Asheville',
    location_state: 'NC',
    timezone: 'America/New_York',
    is_published: true,
    is_demo: false,
    // Texting, through the test copy's stand-in texting service (lib/staging-ghl):
    // the $97 plan texts when an admin turns it on, like a real venue.
    sms_admin_override: true,
    ghl_connected: true,
    ghl_location_id: 'staging-flow-location',
    ghl_access_token: 'pit-staging-fake',
  }, { onConflict: 'id' });
  if (error) throw new Error(`flow venue: ${error.message}`);
}

/** Texts the test copy sent to (or got from) a phone since a time, newest first. */
export async function texts(phone: string, since: string): Promise<Array<{ at: string; direction: 'inbound' | 'outbound'; body: string }>> {
  const res = await fetch(`${env.base}/api/staging/sms?phone=${encodeURIComponent(phone)}&since=${encodeURIComponent(since)}`, { headers: { 'x-staging-key': env.stagingKey } });
  if (!res.ok) throw new Error(`texts: ${res.status}`);
  return ((await res.json()) as { texts: Array<{ at: string; direction: 'inbound' | 'outbound'; body: string }> }).texts;
}

/** The next text the test copy sends to a phone that matches. */
export async function waitForText(phone: string, since: string, match: (body: string) => boolean, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const hit = (await texts(phone, since)).find((t) => t.direction === 'outbound' && match(t.body));
    if (hit) return hit;
    if (Date.now() > until) {
      const seen = (await texts(phone, since)).map((t) => `${t.direction}: ${t.body.slice(0, 70)}`);
      throw new Error(`No matching text to ${phone} within ${timeoutMs / 1000}s. Seen: ${JSON.stringify(seen)}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** A couple texts the venue back (it waits in the stand-in texting service until the app picks it up). */
export async function coupleTexts(from: string, body: string): Promise<void> {
  const res = await fetch(`${env.base}/api/staging/sms`, {
    method: 'POST', headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' }, body: JSON.stringify({ from, body }),
  });
  if (!res.ok) throw new Error(`coupleTexts: ${res.status} ${await res.text()}`);
}

/** Runs one of the app's timed jobs now (the test copy doesn't run them on its own). */
export async function runJob(name: string): Promise<Response> {
  // Some jobs take MARKETING_CRON_SECRET, others CRON_SECRET.
  const secrets = [process.env.MARKETING_CRON_SECRET, process.env.CRON_SECRET].filter(Boolean) as string[];
  let res: Response | null = null;
  for (const secret of secrets) {
    res = await fetch(`${env.base}/api/cron/${name}`, {
      headers: { 'x-staging-key': env.stagingKey, authorization: `Bearer ${secret}` },
    });
    if (res.status !== 401) return res;
  }
  return res!;
}

/** A StoryVenue team super admin (every admin tab), for admin-side checks. */
export const SUPER_ADMIN_EMAIL = 'flow-superadmin@example.com';

export async function ensureSuperAdmin(): Promise<void> {
  const row = {
    email: SUPER_ADMIN_EMAIL, name: 'Flow Super Admin', first_name: 'Flow', last_name: 'Admin', role: 'support_admin',
    is_super_admin: true, active: true, password_hash: await bcrypt.hash(env.password, 10),
  };
  const { data: existing } = await db.from('support_team_members').select('id').ilike('email', SUPER_ADMIN_EMAIL).maybeSingle();
  const { error } = existing
    ? await db.from('support_team_members').update(row).eq('id', existing.id)
    : await db.from('support_team_members').insert(row);
  if (error) throw new Error(`super admin: ${error.message}`);
}

let adminSession: Promise<Browser> | null = null;

/** The super admin, signed in once per run and shared. */
export function signedInSuperAdmin(): Promise<Browser> {
  return (adminSession ??= (async () => {
    await ensureSuperAdmin();
    const b = new Browser();
    const res = await b.fetch('/api/admin/login', { method: 'POST', json: { email: SUPER_ADMIN_EMAIL, password: env.password } });
    if (!res.ok) throw new Error(`super admin sign-in: ${res.status} ${await res.text()}`);
    return b;
  })());
}

/** A couple with a Wedding Planner account, for couple-side checks. */
export const SWEEP_COUPLE = {
  email: 'flow-sweep-couple@example.com',
  get password() { return `Sweep-${env.password.slice(0, 6)}-Planner-2027!`; },
};

export interface CoupleSession { access_token: string; refresh_token: string; expires_at?: number; expires_in: number; token_type: string; user: unknown }

/** The sweep couple's session (signed up the first time). */
export async function coupleSession(): Promise<CoupleSession> {
  const anon = createClient(env.supabaseUrl, String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY), { auth: { persistSession: false } });
  let auth = await anon.auth.signInWithPassword({ email: SWEEP_COUPLE.email, password: SWEEP_COUPLE.password });
  if (auth.error) {
    const res = await fetch(`${env.base}/api/couple/signup`, {
      method: 'POST', headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email: SWEEP_COUPLE.email, password: SWEEP_COUPLE.password, first_name: 'Sweep', last_name: 'Couple', phone: '(646) 555-0142' }),
    });
    if (!res.ok) throw new Error(`couple signup: ${res.status} ${await res.text()}`);
    auth = await anon.auth.signInWithPassword({ email: SWEEP_COUPLE.email, password: SWEEP_COUPLE.password });
  }
  if (auth.error || !auth.data.session) throw new Error(`couple sign-in: ${auth.error?.message}`);
  return auth.data.session as unknown as CoupleSession;
}

/** The first record of each kind a venue has (undefined when it has none). */
export async function venueRecordIds(venueId: string): Promise<Record<string, string | undefined>> {
  const first = async (table: string, column = 'id') => {
    const { data } = await db.from(table).select(column).eq('venue_id', venueId).limit(1);
    return (data?.[0] as Record<string, string> | undefined)?.[column];
  };
  const entries = await Promise.all(Object.entries({
    lead: ['leads'], customer: ['venue_customers'], proposal: ['proposals'], token: ['proposals', 'public_token'],
    thread: ['conversation_threads'], event: ['calendar_events'], automation: ['marketing_automations'],
    campaign: ['marketing_campaigns'], form: ['marketing_forms'], formToken: ['marketing_forms', 'embed_token'],
    segment: ['marketing_segments'], tag: ['marketing_tags'], pipeline: ['lead_pipelines'], template: ['proposal_templates'],
    pkg: ['venue_packages'], coupon: ['venue_coupons'], space: ['venue_spaces'], member: ['venue_team_members'],
  }).map(async ([k, [table, column]]) => [k, await first(table, column)] as const));
  return Object.fromEntries(entries);
}
