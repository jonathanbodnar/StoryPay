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

/** A couple texts the venue back (it waits in the stand-in texting service until the app picks it up). */
export async function coupleTexts(from: string, body: string): Promise<void> {
  const res = await fetch(`${env.base}/api/staging/sms`, {
    method: 'POST', headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' }, body: JSON.stringify({ from, body }),
  });
  if (!res.ok) throw new Error(`coupleTexts: ${res.status} ${await res.text()}`);
}

/** Runs one of the app's timed jobs now (the test copy doesn't run them on its own). */
export async function runJob(name: string): Promise<Response> {
  return fetch(`${env.base}/api/cron/${name}`, {
    headers: { 'x-staging-key': env.stagingKey, authorization: `Bearer ${process.env.MARKETING_CRON_SECRET}` },
  });
}
