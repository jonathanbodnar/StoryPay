import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, coupleSession, db, env, FLOW_VENUE, runId, signedInMasterAdmin, signedInOwner, signedInSuperAdmin, waitForEmail } from './helpers';

// The StoryVenue admin console's own actions: directory badges, the plan
// catalog, inviting team members, announcements venues actually see, and
// saved replies. Each change is checked where it lands, then put back.
describe('the admin console', () => {
  let team: Browser;
  let master: Browser;
  let owner: Browser;

  beforeAll(async () => {
    team = await signedInSuperAdmin();
    master = await signedInMasterAdmin();
    owner = await signedInOwner();
  });

  it('a Verified badge set in the admin shows on the public listing, and junk is refused', async () => {
    const before = (await db.from('venues').select('directory_verified_status').eq('id', FLOW_VENUE.id).single()).data!.directory_verified_status;
    const publicBadge = async () => {
      const res = await fetch(`${env.base}/api/public/venues/${FLOW_VENUE.slug}`, { headers: { 'x-staging-key': env.stagingKey } });
      expect(res.status).toBe(200);
      return ((await res.json()) as { venue: { listing_verified: boolean } }).venue.listing_verified;
    };
    try {
      expect((await master.fetch(`/api/admin/venues/${FLOW_VENUE.id}/directory-badges`, { method: 'PATCH', json: { directory_verified_status: 'definitely-not-a-status' } })).status).toBe(400);
      const on = await master.fetch(`/api/admin/venues/${FLOW_VENUE.id}/directory-badges`, { method: 'PATCH', json: { directory_verified_status: 'approved' } });
      expect(on.status, await on.clone().text()).toBeLessThan(300);
      expect(await publicBadge()).toBe(true);
      const off = await master.fetch(`/api/admin/venues/${FLOW_VENUE.id}/directory-badges`, { method: 'PATCH', json: { directory_verified_status: 'none' } });
      expect(off.status).toBeLessThan(300);
      expect(await publicBadge()).toBe(false);
    } finally {
      await db.from('venues').update({ directory_verified_status: before }).eq('id', FLOW_VENUE.id);
    }
  });

  it('a plan is added to the catalog, renamed, and removed; one without a name is refused', async () => {
    expect((await team.fetch('/api/admin/directory-plans', { method: 'POST', json: { slug: `no-name-${runId}` } })).status).toBe(400);
    const made = await team.fetch('/api/admin/directory-plans', {
      method: 'POST', json: { name: `Test Plan ${runId}`, slug: `test-plan-${runId}`, price_cents: 4_900 },
    });
    expect(made.status, await made.clone().text()).toBeLessThan(300);
    const { data: plan } = await db.from('directory_plans').select('id, is_default').eq('slug', `test-plan-${runId}`).single();
    expect(plan!.is_default).toBeFalsy(); // a test plan must never become every venue's default
    expect((await team.fetch(`/api/admin/directory-plans/${plan!.id}`, { method: 'PATCH', json: { name: `Test Plan ${runId} v2` } })).status).toBeLessThan(300);
    expect((await db.from('directory_plans').select('name').eq('id', plan!.id).single()).data!.name).toBe(`Test Plan ${runId} v2`);
    expect((await team.fetch(`/api/admin/directory-plans/${plan!.id}`, { method: 'DELETE' })).status).toBeLessThan(300);
    expect((await db.from('directory_plans').select('id').eq('id', plan!.id).maybeSingle()).data).toBeNull();
  });

  it('"Login as bride" signs in as the couple and opens their wedding hub, from both admin screens', async () => {
    const session = await coupleSession();
    const coupleId = (session.user as { id: string }).id;
    // The Couples tab and the Contacts tab each have their own route. Both
    // must hand back OUR sign-in page (which opens /couple/wedding), never
    // the login service's own link — that one silently rewrites addresses
    // it doesn't know and stranded admins away from the hub.
    const urls: string[] = [];
    for (const path of [`/api/admin/couples/${coupleId}/impersonate`, `/api/admin/contacts/couple/${coupleId}/impersonate`]) {
      const res = await team.fetch(path, { method: 'POST', json: {} });
      expect(res.status, `${path}: ${await res.clone().text()}`).toBe(200);
      const { url } = (await res.json()) as { url: string };
      expect(url, path).toContain('/couple/signin-link?token_hash=');
      urls.push(url);
    }
    // The link really signs in as this couple: confirming its token the way
    // the page does yields the couple's own session. Only the newest link is
    // checked — issuing a fresh sign-in link voids the ones before it.
    const tokenHash = new URL(urls[urls.length - 1]).searchParams.get('token_hash')!;
    const anon = createClient(env.supabaseUrl, String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY), { auth: { persistSession: false } });
    const confirmed = await anon.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
    expect(confirmed.error?.message ?? null).toBeNull();
    expect(confirmed.data.user?.id).toBe(coupleId);
  });

  it('inviting a team member emails them, and switching them off ends their access', async () => {
    const email = `invited.${runId}@example.com`;
    const since = new Date().toISOString();
    const made = await team.fetch('/api/admin/team-members', {
      method: 'POST', json: { first_name: 'Ivy', last_name: 'Invited', email, password: `Invited-${runId}-Aa1!`, role: 'support_agent', admin_tabs_allowed: { support: true } },
    });
    expect(made.status, await made.clone().text()).toBeLessThan(300);
    await waitForEmail({ to: email, since }, (e) => e.subject === 'Welcome to the StoryVenue admin panel');
    const { data: member } = await db.from('support_team_members').select('id, active, is_super_admin').ilike('email', email).single();
    expect(member!.is_super_admin).toBeFalsy();
    expect((await team.fetch(`/api/admin/team-members/${member!.id}`, { method: 'PATCH', json: { active: false } })).status).toBeLessThan(300);
    expect((await db.from('support_team_members').select('active').eq('id', member!.id).single()).data!.active).toBe(false);
    expect((await team.fetch(`/api/admin/team-members/${member!.id}`, { method: 'DELETE' })).status).toBeLessThan(300);
  });

  it('an announcement reaches venues while it is on, and only then', async () => {
    const message = `Maintenance Sunday night ${runId}`;
    const venueSees = async () => JSON.stringify(await (await owner.fetch('/api/announcements')).json()).includes(message);
    const made = await master.fetch('/api/admin/announcements', { method: 'POST', json: { message } });
    expect(made.status, await made.clone().text()).toBeLessThan(300);
    const { data: row } = await db.from('announcements').select('id').ilike('message', message).single();
    try {
      expect(await venueSees()).toBe(true);
      expect((await master.fetch(`/api/admin/announcements/${row!.id}`, { method: 'PATCH', json: { is_active: false } })).status).toBeLessThan(300);
      expect(await venueSees()).toBe(false);
    } finally {
      await master.fetch(`/api/admin/announcements/${row!.id}`, { method: 'DELETE' });
    }
    expect(await venueSees()).toBe(false);
  });

  it('a saved reply renders with the venue filled in and counts its use', async () => {
    const made = await team.fetch('/api/admin/support/canned-replies', {
      method: 'POST', json: { title: `Welcome ${runId}`, body: 'Hi {{venue_name}}, thanks for writing in!' },
    });
    expect(made.status, await made.clone().text()).toBeLessThan(300);
    const { data: reply } = await db.from('support_canned_replies').select('id, use_count').ilike('title', `Welcome ${runId}`).single();
    // Rendering fills in the venue from a bride-inbox conversation.
    const contact = await owner.fetch('/api/venue-customers', { method: 'POST', json: { customer_email: `render.${runId}@example.com`, first_name: 'Rena', last_name: 'Render' } });
    expect(contact.status, await contact.clone().text()).toBeLessThan(300);
    const open = await owner.fetch(`/api/conversations/open-or-create?email=${encodeURIComponent(`render.${runId}@example.com`)}`);
    expect(open.status, await open.clone().text()).toBe(200);
    const { thread_id: threadId } = (await open.json()) as { thread_id: string };
    try {
      const rendered = await team.fetch(`/api/admin/support/canned-replies/${reply!.id}/render`, { method: 'POST', json: { threadId } });
      expect(rendered.status, await rendered.clone().text()).toBe(200);
      const body = JSON.stringify(await rendered.json());
      expect(body).toContain(FLOW_VENUE.name);
      expect(body).not.toContain('{{venue_name}}');
      expect((await db.from('support_canned_replies').select('use_count').eq('id', reply!.id).single()).data!.use_count).toBe((reply!.use_count ?? 0) + 1);
    } finally {
      await db.from('support_canned_replies').delete().eq('id', reply!.id);
    }
  });
});
