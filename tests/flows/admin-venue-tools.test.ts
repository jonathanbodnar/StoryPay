import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, env, FLOW_VENUE, runId, signedInMasterAdmin, signedInSuperAdmin } from './helpers';

// The admin's venue tools. Suspending a venue keeps its owner and team out
// however they sign in (password, emailed link, API key) while the admin can
// still "View as venue"; restoring it lets them back in. (Until Oct 2 only the
// dashboard pages checked: a suspended owner could still sign in and use
// everything else.) Extending a trial moves its end date.
describe('suspending a venue', () => {
  const email = `suspend.${runId}@example.com`;
  const password = `Suspend-${runId}-Barn-2027!`;
  const owner = new Browser();
  let venueId = '';
  let apiKey = '';
  let master: Browser;

  const v1 = () => fetch(`${env.base}/api/v1/me`, { headers: { 'x-staging-key': env.stagingKey, authorization: `Bearer ${apiKey}` } });
  const suspend = (action: 'suspend' | 'unsuspend', as: Browser) => as.fetch(`/api/admin/venues/${venueId}/suspend`, { method: 'POST', json: { action } });
  const signIn = (b: Browser) => b.fetch('/api/auth/sign-in', { method: 'POST', json: { email, password } });

  beforeAll(async () => {
    const res = await owner.fetch('/api/auth/signup', {
      method: 'POST', json: { venue_name: `Suspend Barn ${runId}`, first_name: 'Sue', last_name: 'Spend', email, phone: '(212) 555-0163', password },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    venueId = (await db.from('venues').select('id').ilike('email', email).single()).data!.id;
    const key = await owner.fetch('/api/integrations/api-keys', { method: 'POST', json: { name: `Suspend ${runId}` } });
    expect(key.status, await key.clone().text()).toBeLessThan(300);
    apiKey = ((await key.json()) as { plaintext: string }).plaintext;
    expect((await v1()).status).toBe(200);
    master = await signedInMasterAdmin();
  });

  it('only the master admin can suspend', async () => {
    expect((await suspend('suspend', await signedInSuperAdmin())).status).toBe(401);
    expect((await suspend('suspend', owner)).status).toBe(401);
    expect((await db.from('venues').select('is_suspended').eq('id', venueId).single()).data!.is_suspended).toBeFalsy();
  });

  it('a suspended venue is signed out and stays out, however it signs in', async () => {
    const res = await suspend('suspend', master);
    expect(res.status, await res.clone().text()).toBe(200);

    // The session it had is over.
    expect((await owner.fetch('/api/venues/me')).status).toBe(401);
    // Its password is refused, with the reason.
    const pw = await signIn(new Browser());
    expect(pw.status).toBe(403);
    expect(((await pw.json()) as { error: string }).error).toMatch(/suspended/i);
    // An emailed sign-in link still opens a session, but it counts for nothing,
    // and the dashboard explains why.
    const token = randomUUID();
    await db.from('venues').update({ login_token: token, login_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(), login_token_last_used_at: null }).eq('id', venueId);
    const link = new Browser();
    expect((await link.fetch(`/api/auth/venue/${token}`)).status).toBeLessThan(400);
    expect((await link.fetch('/api/venues/me')).status).toBe(401);
    const dash = await link.fetch('/dashboard');
    expect(dash.status).toBe(307);
    expect(dash.headers.get('location')).toContain('/suspended');
    // Its API key (Zapier) stops working.
    expect((await v1()).status).toBe(403);
  });

  it('the admin can still view it as the venue', async () => {
    expect((await master.fetch('/api/admin/impersonate', { method: 'POST', json: { venueId } })).status).toBe(200);
    try {
      const me = await master.fetch('/api/venues/me');
      expect(me.status).toBe(200);
      expect(JSON.stringify(await me.json())).toContain(`Suspend Barn ${runId}`);
      expect((await master.fetch('/dashboard')).headers.get('location') ?? '').not.toContain('/suspended');
    } finally {
      await master.fetch('/api/admin/impersonate/exit', { method: 'POST' });
    }
  });

  it('restoring it lets the owner back in, with the same API key', async () => {
    const res = await suspend('unsuspend', master);
    expect(res.status, await res.clone().text()).toBe(200);
    const back = new Browser();
    expect((await signIn(back)).status).toBe(200);
    expect((await back.fetch('/api/venues/me')).status).toBe(200);
    expect((await v1()).status).toBe(200);
  });

  it('extending the trial moves its end date; a date in the past is refused', async () => {
    const ends = new Date(Date.now() + 45 * 86_400_000);
    const res = await master.fetch(`/api/admin/venues/${venueId}/extend-trial`, { method: 'POST', json: { trial_ends_at: ends.toISOString() } });
    expect(res.status, await res.clone().text()).toBe(200);
    const { data } = await db.from('venues').select('directory_trial_ends_at').eq('id', venueId).single();
    expect(Date.parse(data!.directory_trial_ends_at)).toBe(ends.getTime());
    const past = await master.fetch(`/api/admin/venues/${venueId}/extend-trial`, { method: 'POST', json: { trial_ends_at: '2020-01-01' } });
    expect(past.status).toBe(400);
  });
});

// A StoryVenue team member who isn't a full admin can look across the admin
// but only change things behind the tabs they've been given. (Until Oct 2 any
// team login could refund a venue, change prices or switch off the AI.)
describe('a team member’s tabs limit what they can change', () => {
  const email = 'flow-limited-support@example.com';
  const limited = new Browser();

  beforeAll(async () => {
    const row = {
      email, name: 'Flow Limited', first_name: 'Flow', last_name: 'Limited', role: 'support_agent', is_super_admin: false,
      admin_tabs_allowed: { support: true }, active: true, password_hash: await bcrypt.hash(env.password, 10),
    };
    const { data: existing } = await db.from('support_team_members').select('id').ilike('email', email).maybeSingle();
    const { error } = existing
      ? await db.from('support_team_members').update(row).eq('id', existing.id)
      : await db.from('support_team_members').insert(row);
    if (error) throw new Error(`team member: ${error.message}`);
    const res = await limited.fetch('/api/admin/login', { method: 'POST', json: { email, password: env.password } });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('reads as before', async () => {
    expect((await limited.fetch('/api/admin/subscriptions')).status).toBe(200);
    expect((await limited.fetch('/api/admin/support/inbox-count')).status).toBe(200);
  });

  it('changes outside their tabs are refused; a full admin’s go through', async () => {
    const billing = (b: Browser) => b.fetch(`/api/admin/venues/${FLOW_VENUE.id}/billing-action`, { method: 'POST', json: { action: 'no_such_action' } });
    expect([401, 403]).toContain((await billing(limited)).status);
    expect([401, 403]).not.toContain((await billing(await signedInSuperAdmin())).status);
    const preview = await limited.fetch('/api/admin/ai-concierge/configs/preview', { method: 'POST', json: {} });
    expect([401, 403]).toContain(preview.status);
  });

  it('they can still "View as venue" from the support inbox, and come back', async () => {
    const res = await limited.fetch('/api/admin/impersonate', { method: 'POST', json: { venueId: FLOW_VENUE.id } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await limited.fetch('/api/admin/impersonate/exit', { method: 'POST' })).status).toBe(200);
  });
});
