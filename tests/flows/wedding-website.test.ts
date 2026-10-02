import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { env, FLOW_VENUE, outbox, runId, waitForEmail } from './helpers';

// The couple side beyond the planner basics: inviting a guest, the guest's
// RSVP from the emailed link (the couple hears about it, the venue doesn't),
// and the wedding website: published, behind a password, with a guestbook.
// The website's public calls come through the directory, which signs them.
describe('a couple’s guests and wedding website', () => {
  const email = `site.couple.${runId}@example.com`;
  const password = `Website-${runId}-Garden-2027!`;
  const guestEmail = `guest.${runId}@example.com`;
  const slug = `flow-${runId}`;
  let token = '';

  const api = (path: string, init: { method?: string; json?: unknown } = {}) => fetch(`${env.base}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'x-staging-key': env.stagingKey, authorization: `Bearer ${token}`,
      ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  /** A public website call, signed as the directory signs it. */
  const directory = (path: string, body: unknown) => {
    const raw = JSON.stringify(body);
    return fetch(`${env.base}${path}`, {
      method: 'POST',
      headers: {
        'x-staging-key': env.stagingKey, 'content-type': 'application/json',
        'x-storypay-signature': createHmac('sha256', env.leadSecret).update(raw).digest('hex'),
      },
      body: raw,
    });
  };

  beforeAll(async () => {
    const signup = await fetch(`${env.base}/api/couple/signup`, {
      method: 'POST', headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, first_name: 'Sky', last_name: 'Site', phone: `(646) 552-${(parseInt(runId.slice(-5), 36) % 9000) + 1000}` }),
    });
    expect(signup.status, await signup.clone().text()).toBe(200);
    const anon = createClient(env.supabaseUrl, String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY), { auth: { persistSession: false } });
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    token = data.session!.access_token;
  });

  it('a guest invited by email RSVPs from the link; the couple hears, the venue doesn’t', async () => {
    const added = await api('/api/couple/guests', { method: 'POST', json: { full_name: 'Gale Guest', email: guestEmail, party_size: 2 } });
    expect(added.status, await added.clone().text()).toBeLessThan(300);
    const list = (await (await api('/api/couple/guests')).json()) as { guests?: Array<{ id: string; full_name: string }> };
    const guest = (list.guests ?? []).find((g) => g.full_name === 'Gale Guest')!;
    const since = new Date().toISOString();
    const invite = await api(`/api/couple/guests/${guest.id}/invite`, { method: 'POST' });
    expect(invite.status, await invite.clone().text()).toBeLessThan(300);
    const mail = await waitForEmail({ to: guestEmail, since }, () => true);
    const rsvpToken = mail.html.replace(/&amp;/g, '&').match(/\/rsvp\/([A-Za-z0-9_-]+)/)![1];
    const rsvp = await fetch(`${env.base}/api/rsvp/${rsvpToken}`, {
      method: 'POST', headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' },
      body: JSON.stringify({ attending: true, headcount: 2 }),
    });
    expect(rsvp.status, await rsvp.clone().text()).toBeLessThan(300);
    const after = (await (await api('/api/couple/guests')).json()) as { guests?: Array<{ full_name: string; rsvp_status?: string }> };
    expect(after.guests!.find((g) => g.full_name === 'Gale Guest')!.rsvp_status).toMatch(/attend|yes|accepted/i);
    await waitForEmail({ to: email, since }, (e) => /gale/i.test(e.subject + e.html));
    expect((await outbox({ to: FLOW_VENUE.email, since })).filter((e) => /gale guest/i.test(e.subject + e.html))).toHaveLength(0);
  });

  it('the wedding website publishes at its own link; a password keeps it private until unlocked', async () => {
    expect((await api(`/api/couple/site/slug-check?slug=${slug}`)).status).toBe(200);
    const saved = await api('/api/couple/site', { method: 'PUT', json: { slug, headline: `Sky & River ${runId}`, partner_name: 'River', is_published: true, show_guestbook: true } });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const open = await fetch(`${env.base}/api/public/minisite/${slug}`, { headers: { 'x-staging-key': env.stagingKey } });
    expect(open.status).toBe(200);
    expect(await open.text()).toContain(`Sky & River ${runId}`);

    expect((await api('/api/couple/site', { method: 'PUT', json: { site_password: 'garden-party' } })).status).toBe(200);
    const locked = await fetch(`${env.base}/api/public/minisite/${slug}`, { headers: { 'x-staging-key': env.stagingKey } });
    expect(await locked.text()).not.toContain(`Sky & River ${runId}`);
    const wrong = await directory(`/api/public/minisite/${slug}/unlock`, { password: 'wrong' });
    expect(((await wrong.json()) as { ok: boolean; token?: string })).toMatchObject({ ok: false });
    const unlock = await directory(`/api/public/minisite/${slug}/unlock`, { password: 'garden-party' });
    expect(unlock.status, await unlock.clone().text()).toBe(200);
    const k = ((await unlock.json()) as { token?: string; k?: string }).token ?? '';
    expect(k).toBeTruthy();
    const unlocked = await fetch(`${env.base}/api/public/minisite/${slug}?k=${encodeURIComponent(k)}`, { headers: { 'x-staging-key': env.stagingKey } });
    expect(await unlocked.text()).toContain(`Sky & River ${runId}`);
    // Back to open for the guestbook.
    expect((await api('/api/couple/site', { method: 'PUT', json: { site_password: '' } })).status).toBe(200);
  });

  it('a guest signs the guestbook through the directory; an unsigned post is refused', async () => {
    expect((await fetch(`${env.base}/api/public/minisite/${slug}/guestbook`, {
      method: 'POST', headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' }, body: JSON.stringify({ guest_name: 'X', message: 'spam' }),
    })).status).toBe(401);
    const posted = await directory(`/api/public/minisite/${slug}/guestbook`, { guest_name: 'Gale Guest', message: `Congratulations ${runId}!` });
    expect(posted.status, await posted.clone().text()).toBeLessThan(300);
    const wall = (await (await api('/api/couple/site/guestbook')).json()) as unknown;
    expect(JSON.stringify(wall)).toContain(`Congratulations ${runId}!`);
  });
});
