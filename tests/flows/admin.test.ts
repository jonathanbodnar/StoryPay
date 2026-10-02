import bcrypt from 'bcryptjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, env, FLOW_VENUE, signedInOwner, waitForEmail } from './helpers';

// The admin side, as a StoryVenue team member (email + password). The master
// admin's sign-in emails a code to the owner's real inbox even on the test
// copy, so it isn't run on every check.
describe('the StoryVenue team', () => {
  const email = 'flow-support@example.com';
  const team = new Browser();

  async function setMember(active: boolean) {
    const row = { email, name: 'Flow Support', first_name: 'Flow', last_name: 'Support', role: 'support_admin', password_hash: await bcrypt.hash(env.password, 10), active };
    const { data: existing } = await db.from('support_team_members').select('id').ilike('email', email).maybeSingle();
    const { error } = existing
      ? await db.from('support_team_members').update(row).eq('id', existing.id)
      : await db.from('support_team_members').insert(row);
    if (error) throw new Error(`team member: ${error.message}`);
  }
  const signIn = (b: Browser, password: string) => b.fetch('/api/admin/login', { method: 'POST', json: { email, password } });

  beforeAll(async () => {
    await setMember(true);
  });

  it('a team member signs in and the admin knows who they are', async () => {
    const res = await signIn(team, env.password);
    expect(res.status, await res.clone().text()).toBe(200);
    const me = await team.fetch('/api/admin/me');
    expect(me.status).toBe(200);
    expect(JSON.stringify(await me.json())).toContain(email);
  });

  it('they can work the support inbox', async () => {
    expect((await team.fetch('/api/admin/support/bride-inbox')).status).toBe(200);
    expect((await team.fetch('/api/admin/support/inbox-count')).status).toBe(200);
  });

  it('a wrong password, or a deactivated member, is refused', async () => {
    expect((await signIn(new Browser(), `${env.password}-wrong`)).status).toBe(401);
    await setMember(false);
    try {
      expect((await signIn(new Browser(), env.password)).status).toBe(401);
    } finally {
      await setMember(true);
    }
  });
});

// The master admin: password, then a one-time code by email. On the test copy
// the code lands in its outbox (quiet mode), so the owner's inbox stays clean.
describe('the master admin', () => {
  const admin = new Browser();
  const email = process.env.ADMIN_EMAIL || '';
  const password = process.env.ADMIN_PASSWORD || '';

  it('signs in with the password and the emailed code; a wrong code is refused', async () => {
    const since = new Date().toISOString();
    const res = await admin.fetch('/api/admin/login', { method: 'POST', json: { email, password } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { step?: string }).step).toBe('otp_required');
    const { data } = await db.from('admin_otp_tokens').select('code').eq('used', false).order('created_at', { ascending: false }).limit(1).single();
    const code = String(data!.code);
    const mail = await waitForEmail({ to: email, since }, (e) => e.html.includes(code));
    expect(mail.delivered).toBe(false); // quiet: it never left the test copy
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    expect((await admin.fetch('/api/admin/auth/verify-otp', { method: 'POST', json: { code: wrong } })).status).toBe(401);
    const ok = await admin.fetch('/api/admin/auth/verify-otp', { method: 'POST', json: { code } });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect((await admin.fetch('/api/admin/venues')).status).toBe(200);
    // The same code can't be used again.
    expect((await new Browser().fetch('/api/admin/auth/verify-otp', { method: 'POST', json: { code } })).status).toBeGreaterThanOrEqual(400);
  });

  it('logs in as a venue, sees what the venue sees, and comes back', async () => {
    const res = await admin.fetch('/api/admin/impersonate', { method: 'POST', json: { venueId: FLOW_VENUE.id } });
    expect(res.status, await res.clone().text()).toBe(200);
    const me = await admin.fetch('/api/venues/me');
    expect(me.status).toBe(200);
    expect(JSON.stringify(await me.json())).toContain(FLOW_VENUE.name);
    expect(((await (await admin.fetch('/api/auth/impersonation-status')).json()) as { impersonating: boolean }).impersonating).toBe(true);
    expect((await admin.fetch('/api/admin/impersonate/exit', { method: 'POST' })).status).toBe(200);
    expect(((await (await admin.fetch('/api/auth/impersonation-status')).json()) as { impersonating: boolean }).impersonating).toBe(false);
  });

  it('a venue owner can’t log in as another venue', async () => {
    const owner = await signedInOwner();
    expect([401, 403]).toContain((await owner.fetch('/api/admin/impersonate', { method: 'POST', json: { venueId: '00000000-0000-4000-8000-000000000000' } })).status);
  });
});
