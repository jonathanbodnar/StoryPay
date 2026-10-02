import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, env, outbox, runId, runJob, signedInMasterAdmin, submitListingLead, texts, waitForEmail, waitForText } from './helpers';

// While a venue is suspended nothing automated goes from it to couples: a new
// lead gets no automatic guide, and a campaign waits, then goes out when the
// venue is restored. (Owner's call, Oct 2.) A venue of its own, set up like
// the flow venue, so no other test is affected.
const VENUE = { id: 'a7f10000-0000-4000-8000-000000000002', name: 'Flow Suspended Venue', slug: 'flow-suspended-venue', email: 'flow-suspended-owner@example.com' };
const n = (parseInt(runId.slice(-5), 36) % 9000) + 1000;

describe('a suspended venue sends nothing automated', () => {
  let owner: Browser;
  let master: Browser;
  const suspend = async (action: 'suspend' | 'unsuspend') => {
    const res = await master.fetch(`/api/admin/venues/${VENUE.id}/suspend`, { method: 'POST', json: { action } });
    expect(res.status, await res.clone().text()).toBe(200);
  };
  const lead = async (first: string, phone: string) => {
    const res = await submitListingLead({
      venue_id: VENUE.id, first_name: first, last_name: 'Paused', email: `${first.toLowerCase()}.paused.${runId}@example.com`, phone,
      guest_count: 80, message: 'Pricing please!', source: 'directory', client_ip: `198.51.100.${70 + (n % 100)}`,
    });
    expect(res.status, await res.clone().text()).toBe(201);
  };

  beforeAll(async () => {
    const { data: plan } = await db.from('directory_plans').select('id').eq('slug', 'bride-booking-system').single();
    const { error } = await db.from('venues').upsert({
      id: VENUE.id, name: VENUE.name, slug: VENUE.slug, email: VENUE.email, notification_email: VENUE.email, brand_email: VENUE.email,
      password_hash: await bcrypt.hash(env.password, 10), setup_completed: true, onboarding_status: 'registered',
      onboarding_completed_at: new Date().toISOString(), directory_plan_id: plan?.id ?? null, directory_subscription_status: 'active',
      email_verified_at: new Date().toISOString(), owner_first_name: 'Paused', owner_last_name: 'Owner', location_city: 'Asheville', location_state: 'NC',
      timezone: 'America/New_York', is_published: true, is_demo: false, is_suspended: false,
      sms_admin_override: true, ghl_connected: true, ghl_location_id: 'staging-flow-location-2', ghl_access_token: 'pit-staging-fake',
    }, { onConflict: 'id' });
    if (error) throw new Error(`suspended venue: ${error.message}`);
    master = await signedInMasterAdmin();
    await suspend('unsuspend'); // in case an earlier run stopped half way
    owner = new Browser();
    await owner.signIn(VENUE.email);
  });

  afterAll(async () => {
    await suspend('unsuspend');
  });

  it('a new lead gets the automatic guide while the venue is active (the control)', async () => {
    const since = new Date().toISOString();
    await lead('Cleo', `(332) 581-${n}`);
    await waitForText(`(332) 581-${n}`, since, (b) => /guide/i.test(b));
  });

  it('suspended: a new lead gets no guide, and a campaign waits; restored: the campaign goes out', async () => {
    // A campaign the venue sent just before it was suspended.
    const subject = `Fall open house ${runId}`;
    const to = `cleo.paused.${runId}@example.com`;
    const created = await owner.fetch('/api/marketing/campaigns', { method: 'POST', json: { name: subject, subject, segment: { type: 'specific_contacts', contact_emails: [to] } } });
    expect(created.status, await created.clone().text()).toBe(200);
    const { campaign } = (await created.json()) as { campaign: { id: string; template_id: string } };
    expect((await owner.fetch(`/api/marketing/email-templates/${campaign.template_id}`, {
      method: 'PATCH',
      json: { definition: { version: 1, blocks: [{ id: 't', type: 'text', content: '<p>Come see the barn in October.</p>' }], theme: { pageBg: '#ffffff', cardBg: '#ffffff', textColor: '#18181b', mutedColor: '#71717a', buttonBg: '#18181b', buttonText: '#ffffff', maxWidth: '600px', fontFamily: 'Georgia, serif' } } },
    })).status).toBe(200);
    expect((await owner.fetch(`/api/marketing/campaigns/${campaign.id}`, { method: 'PATCH', json: { action: 'send_now' } })).status).toBe(200);

    await suspend('suspend');
    const since = new Date().toISOString();
    await lead('Bea', `(332) 582-${n}`);
    for (let i = 0; i < 2; i++) expect((await runJob('marketing-email')).status).toBe(200);
    await new Promise((r) => setTimeout(r, 4000));
    expect(await outbox({ to: `bea.paused.${runId}@example.com`, since })).toHaveLength(0);
    expect((await texts(`(332) 582-${n}`, since)).filter((t) => t.direction === 'outbound')).toHaveLength(0);
    expect((await outbox({ to, since })).filter((e) => e.subject === subject)).toHaveLength(0);

    await suspend('unsuspend');
    for (let i = 0; i < 2; i++) expect((await runJob('marketing-email')).status).toBe(200);
    await waitForEmail({ to, since }, (e) => e.subject === subject);
  });
});
