import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { Browser, db, env, fetchWithCookies, FLOW_VENUE, runId, signedInOwner, waitForEmail } from './helpers';

// Every way into an account besides email + password: password resets (venue
// owner, team member, StoryVenue team, couple), the emailed sign-in link, team
// invites, and signing out. Reset and sign-in links work once.

const link = (html: string, re: RegExp) => {
  const m = html.replace(/&amp;/g, '&').match(re);
  if (!m) throw new Error(`no link matching ${re} in the email`);
  return m[1];
};

describe('a venue owner who forgot their password, or wants an emailed sign-in link', () => {
  const venueId = randomUUID();
  const email = `reset-owner.${runId}@example.com`;
  const newPassword = `Reset-${runId}-Garden-2027!`;
  let since = '';

  beforeAll(async () => {
    since = new Date().toISOString();
    const { error } = await db.from('venues').insert({
      id: venueId, name: `Reset Venue ${runId}`, slug: `reset-venue-${runId}`, email, notification_email: email,
      password_hash: await bcrypt.hash(env.password, 10), setup_completed: true, onboarding_status: 'registered',
      onboarding_completed_at: new Date().toISOString(), email_verified_at: new Date().toISOString(), timezone: 'America/New_York',
    });
    if (error) throw new Error(error.message);
  });

  it('resets the password from the emailed link, once', async () => {
    expect((await new Browser().fetch('/api/auth/venue/forgot', { method: 'POST', json: { email } })).status).toBe(200);
    const mail = await waitForEmail({ to: email, since }, (e) => /reset/i.test(e.subject));
    const token = link(mail.html, /\/reset-password\/venue\?token=([A-Za-z0-9_-]+)/);
    const owner = new Browser();
    const reset = await owner.fetch('/api/auth/venue/reset', { method: 'POST', json: { token, password: newPassword } });
    expect(reset.status, await reset.clone().text()).toBe(200);
    expect((await owner.fetch('/api/venues/me')).status).toBe(200); // signed in by the reset
    const again = await new Browser().fetch('/api/auth/venue/reset', { method: 'POST', json: { token, password: `${newPassword}x` } });
    expect(again.status).toBe(400); // the link worked once
    const old = await new Browser().fetch('/api/auth/sign-in', { method: 'POST', json: { email, password: env.password } });
    expect(old.status).toBe(401);
    await new Browser().signIn(email, newPassword);
  });

  it('signs in from the emailed sign-in link, which then stops working', async () => {
    const sentAt = new Date().toISOString();
    expect((await new Browser().fetch('/api/auth/request-login', { method: 'POST', json: { email } })).status).toBe(200);
    const mail = await waitForEmail({ to: email, since: sentAt }, (e) => /login link/i.test(e.subject));
    const token = link(mail.html, /\/login\/([A-Za-z0-9_-]+)/);
    const b = new Browser();
    const res = await b.fetch(`/api/auth/venue/${token}`);
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get('location') ?? '').toMatch(/\/dashboard/);
    expect((await b.fetch('/api/venues/me')).status).toBe(200);
    const reuse = await new Browser().fetch(`/api/auth/venue/${token}`);
    expect(reuse.headers.get('location') ?? '').not.toMatch(/\/dashboard$/);
  });

  // Oct 5 2026: pressing Logout could leave the browser signed in. Every
  // answer to a signed-in request renews the session's cookies, and an answer
  // still on its way when Logout was pressed arrived after it and put them
  // back. Within a second of a page opening that happened every time. Logout
  // now also leaves a marker ("sessions before now are over") that the proxy
  // holds every session against.
  // A renewal sets the session's own cookies again and nothing else.
  const sessionOf = (cookies: Record<string, string>) =>
    Object.fromEntries(Object.entries(cookies).filter(([name]) => /^(venue_id|member_id)(_meta|_sig)?$/.test(name)));

  it('signing out ends the session, and it stays ended when a late answer puts the old cookies back', async () => {
    const b = new Browser();
    await b.signIn(email, newPassword);
    expect((await b.fetch('/api/venues/me')).status).toBe(200);
    const signedIn = sessionOf(b.cookies());
    expect(Object.keys(signedIn).sort()).toEqual(['venue_id', 'venue_id_meta', 'venue_id_sig']);

    await b.fetch('/api/auth/logout');
    expect((await b.fetch('/api/venues/me')).status).toBe(401);
    const signedOut = b.cookies();
    expect(signedOut.venue_id).toBeUndefined();
    expect(signedOut.sv_sessions_ended).toMatch(/^\d+$/);

    // The late answer: the browser has its old session cookies again.
    const renewed = await fetchWithCookies('/api/venues/me', { ...signedOut, ...signedIn });
    expect(renewed.status).toBe(401);
    // …and nothing renews them a second time.
    expect(renewed.headers.getSetCookie().join('\n')).not.toMatch(/(^|\n)venue_id=[^;]/);
    // (Those cookies are a session still within its life: it is this
    // browser's marker that ends it. Without that they'd be let in, which is
    // what used to happen.)
    expect((await fetchWithCookies('/api/venues/me', signedIn)).status).toBe(200);

    // Signing in again, in the same browser, works at once.
    await b.signIn(email, newPassword);
    expect((await b.fetch('/api/venues/me')).status).toBe(200);
  });

  // The mirror of it: signing in while an older session's answers are still
  // arriving could put the browser back in the OLD account.
  it('signing in as someone else ends the session that was there, even if its cookies come back', async () => {
    const b = new Browser();
    await b.signIn(email, newPassword);
    const first = sessionOf(b.cookies());
    // (Signing in can't know which session it is replacing, so it ends every
    // session more than two seconds old: any that a person had been using.)
    await new Promise((r) => setTimeout(r, 3500));
    // The second account is this test's own (the shared owner's sign-ins are for the files that need it).
    const otherId = randomUUID();
    const other = `reset-other.${runId}@example.com`;
    const made = await db.from('venues').insert({
      id: otherId, name: `Reset Other ${runId}`, slug: `reset-other-${runId}`, email: other, notification_email: other,
      password_hash: await bcrypt.hash(env.password, 10), setup_completed: true, onboarding_status: 'registered',
      onboarding_completed_at: new Date().toISOString(), email_verified_at: new Date().toISOString(), timezone: 'America/New_York',
    });
    expect(made.error?.message ?? null).toBeNull();
    await b.signIn(other);
    expect((await b.fetch('/api/venues/me')).status).toBe(200);
    // A late renewal of the first session lands over the new one's cookies:
    // signed out, rather than quietly back in the first account.
    expect((await fetchWithCookies('/api/venues/me', { ...b.cookies(), ...first })).status).toBe(401);
    // The browser's own cookies, untouched, are the second account's.
    expect((await b.fetch('/api/venues/me')).status).toBe(200);
  });
});

describe('team invites and team passwords', () => {
  const email = `invited.${runId}@example.com`;
  let owner: Browser;
  let memberId = '';
  let inviteToken = '';
  const member = new Browser();
  let since = '';

  beforeAll(async () => {
    owner = await signedInOwner();
    since = new Date().toISOString();
  });

  it('the owner invites someone; the emailed link signs them in as a member', async () => {
    const res = await owner.fetch('/api/team', {
      method: 'POST', json: { first_name: 'Ivy', last_name: 'Invited', email, phone: '(212) 555-0163', role: 'member' },
    });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    const mail = await waitForEmail({ to: email, since }, (e) => /invited to join/i.test(e.subject));
    inviteToken = link(mail.html, /\/api\/invite\/([A-Za-z0-9_-]+)/);
    const accept = await member.fetch(`/api/invite/${inviteToken}`);
    expect(accept.headers.get('location') ?? '').toMatch(/\/dashboard/);
    const { data } = await db.from('venue_team_members').select('id, status').ilike('email', email).single();
    memberId = data!.id;
    expect(data!.status).toBe('active');
    expect((await member.fetch('/api/leads')).status).toBe(200);
  });

  it('the owner sends a set-password link; the member picks a password and signs in with it', async () => {
    const sentAt = new Date().toISOString();
    expect((await owner.fetch(`/api/team/${memberId}/reset-password`, { method: 'POST' })).status).toBeLessThan(300);
    const mail = await waitForEmail({ to: email, since: sentAt }, (e) => /password/i.test(e.subject));
    const token = link(mail.html, /\/reset-password\/member\?token=([A-Za-z0-9_-]+)/);
    const password = `Member-${runId}-Lilac-2027!`;
    const res = await new Browser().fetch('/api/auth/member/reset', { method: 'POST', json: { token, password } });
    expect(res.status, await res.clone().text()).toBe(200);
    await new Browser().signIn(email, password);
    // The set-password link changed the member's token, so the old link is spent.
    inviteToken = (await db.from('venue_team_members').select('invite_token').eq('id', memberId).single()).data!.invite_token;
  });

  it('a member the owner switches off is signed out, and their old email link can’t switch them back on', async () => {
    expect((await owner.fetch(`/api/team/${memberId}`, { method: 'PATCH', json: { status: 'inactive' } })).status).toBe(200);
    const until = Date.now() + 80_000;
    let status = 0;
    while (Date.now() < until) {
      status = (await member.fetch('/api/leads')).status;
      if (status === 401) break;
      await new Promise((r) => setTimeout(r, 5_000));
    }
    expect(status).toBe(401);
    const res = await new Browser().fetch(`/api/invite/${inviteToken}`);
    expect(res.headers.get('location') ?? '').toMatch(/\/invite\/invalid/);
    const { data } = await db.from('venue_team_members').select('status').eq('id', memberId).single();
    expect(data!.status).toBe('inactive');
  }, 100_000);
});

describe('the StoryVenue team and couples reset their passwords', () => {
  const email = `flow-reset-admin.${runId}@example.com`;
  let since = '';

  beforeAll(async () => {
    since = new Date().toISOString();
    const { error } = await db.from('support_team_members').insert({
      email, name: 'Reset Admin', first_name: 'Reset', last_name: 'Admin', role: 'support_agent', active: true,
      password_hash: await bcrypt.hash(env.password, 10),
    });
    if (error) throw new Error(error.message);
  });

  it('a team member resets their admin password from the emailed link, once', async () => {
    expect((await new Browser().fetch('/api/admin/auth/forgot', { method: 'POST', json: { email } })).status).toBe(200);
    const mail = await waitForEmail({ to: email, since }, (e) => /admin password/i.test(e.subject));
    const token = link(mail.html, /\/reset-password\/admin\?token=([A-Za-z0-9_-]+)/);
    const password = `Admin-${runId}-Cedar-2027!`;
    const res = await new Browser().fetch('/api/admin/auth/reset', { method: 'POST', json: { token, password } });
    expect(res.status, await res.clone().text()).toBe(200);
    const again = await new Browser().fetch('/api/admin/auth/reset', { method: 'POST', json: { token, password: `${password}x` } });
    expect(again.status).toBe(400); // the link worked once
    const signIn = await new Browser().fetch('/api/admin/login', { method: 'POST', json: { email, password } });
    expect(signIn.status).toBe(200);
  });

  it('a couple resets their planner password from the emailed link, which opens this site', async () => {
    const coupleEmail = `reset.couple.${runId}@example.com`;
    const oldPassword = `Couple-${runId}-Old-2027!`;
    const newPassword = `Couple-${runId}-New-2027!`;
    const signup = await fetch(`${env.base}/api/couple/signup`, {
      method: 'POST', headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email: coupleEmail, password: oldPassword, first_name: 'Rae', last_name: 'Reset', phone: `(646) 553-${(parseInt(runId.slice(-5), 36) % 9000) + 1000}` }),
    });
    expect(signup.status, await signup.clone().text()).toBe(200);
    const sentAt = new Date().toISOString();
    expect((await new Browser().fetch('/api/auth/couple/forgot', { method: 'POST', json: { email: coupleEmail } })).status).toBe(200);
    const mail = await waitForEmail({ to: coupleEmail, since: sentAt }, (e) => /reset/i.test(e.subject));
    const html = mail.html.replace(/&amp;/g, '&');
    const tokenHash = link(html, new RegExp(`${env.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/couple/reset-password\\?token_hash=([^&"]+)&type=recovery`));
    // What the reset page does: confirm the link, then set the new password.
    const anon = createClient(env.supabaseUrl, String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY), { auth: { persistSession: false } });
    const verified = await anon.auth.verifyOtp({ token_hash: decodeURIComponent(tokenHash), type: 'recovery' });
    expect(verified.error).toBeNull();
    expect((await anon.auth.updateUser({ password: newPassword })).error).toBeNull();
    const fresh = createClient(env.supabaseUrl, String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY), { auth: { persistSession: false } });
    expect((await fresh.auth.signInWithPassword({ email: coupleEmail, password: newPassword })).error).toBeNull();
    expect((await fresh.auth.signInWithPassword({ email: coupleEmail, password: oldPassword })).error).not.toBeNull();
    // The link worked once.
    const again = createClient(env.supabaseUrl, String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY), { auth: { persistSession: false } });
    expect((await again.auth.verifyOtp({ token_hash: decodeURIComponent(tokenHash), type: 'recovery' })).error).not.toBeNull();
  });

  it('nobody learns whether an email has an account', async () => {
    for (const path of ['/api/auth/venue/forgot', '/api/admin/auth/forgot', '/api/auth/couple/forgot', '/api/auth/request-login']) {
      const res = await new Browser().fetch(path, { method: 'POST', json: { email: `nobody.${runId}@example.com` } });
      expect(res.status, path).toBe(200);
    }
    expect(FLOW_VENUE.email).toBeTruthy();
  });
});
