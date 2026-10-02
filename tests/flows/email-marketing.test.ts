import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, env, FLOW_VENUE, outbox, runId, runJob, signedInOwner, submitListingLead, waitForEmail } from './helpers';

// Email marketing, the venue's own campaigns: a campaign reaches exactly the
// couples it's sent to, each email carries a working unsubscribe link (a legal
// requirement), and someone who unsubscribed, bounced or complained gets
// nothing more until they resubscribe.
describe('email campaigns and unsubscribing', () => {
  const ava = `ava.mkt.${runId}@example.com`;
  const ben = `ben.mkt.${runId}@example.com`;
  const cara = `cara.mkt.${runId}@example.com`;
  let owner: Browser;
  const leadIds: Record<string, string> = {};

  async function lead(first: string, email: string, n: number): Promise<void> {
    const res = await submitListingLead({
      venue_id: FLOW_VENUE.id, first_name: first, last_name: 'Marketing', email,
      phone: `(332) 55${n}-${(parseInt(runId.slice(-5), 36) % 9000) + 1000}`, source: 'directory', client_ip: `203.0.113.${60 + n}`,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    leadIds[email] = ((await res.json()) as { lead_id: string }).lead_id;
  }

  /** Create a campaign with a subject and a body, send it now, and run the email job. */
  async function sendCampaign(name: string, emails: string[]): Promise<string> {
    const subject = `${name} ${runId}`;
    const created = await owner.fetch('/api/marketing/campaigns', {
      method: 'POST', json: { name: subject, subject, segment: { type: 'specific_contacts', contact_emails: emails } },
    });
    expect(created.status, await created.clone().text()).toBe(200);
    const { campaign } = (await created.json()) as { campaign: { id: string; template_id: string } };
    const body = await owner.fetch(`/api/marketing/email-templates/${campaign.template_id}`, {
      method: 'PATCH',
      json: {
        definition: {
          version: 1,
          blocks: [
            { id: 'h', type: 'heading', level: 1, content: 'Our fall open house' },
            { id: 't', type: 'text', content: '<p>Hi {{contact.first_name}}, come walk the barn with us on October 18.</p>' },
          ],
          theme: { pageBg: '#f4f4f5', cardBg: '#ffffff', textColor: '#18181b', mutedColor: '#71717a', buttonBg: '#18181b', buttonText: '#ffffff', maxWidth: '600px', fontFamily: 'Georgia, serif' },
        },
      },
    });
    expect(body.status, await body.clone().text()).toBe(200);
    const send = await owner.fetch(`/api/marketing/campaigns/${campaign.id}`, { method: 'PATCH', json: { action: 'send_now' } });
    expect(send.status, await send.clone().text()).toBe(200);
    for (let i = 0; i < 3; i++) expect((await runJob('marketing-email')).status).toBe(200);
    return subject;
  }

  const unsubscribeLink = (html: string) => {
    const m = html.match(/https?:\/\/[^"'\s]+\/api\/public\/marketing\/unsubscribe\?token=[^"'\s]+/);
    return m ? m[0].replace(/&amp;/g, '&') : null;
  };

  beforeAll(async () => {
    owner = await signedInOwner();
    await lead('Ava', ava, 1);
    await lead('Ben', ben, 2);
    await lead('Cara', cara, 3);
  });

  it('a campaign reaches exactly its couples, with the venue’s name and an unsubscribe link', async () => {
    const since = new Date().toISOString();
    const subject = await sendCampaign('Open house', [ava, ben]);
    const toAva = await waitForEmail({ to: ava, since }, (e) => e.subject === subject);
    await waitForEmail({ to: ben, since }, (e) => e.subject === subject);
    expect(toAva.html).toContain('come walk the barn');
    expect(toAva.html).toContain('Hi Ava');
    expect(toAva.html).toContain(FLOW_VENUE.name);
    expect(unsubscribeLink(toAva.html)).toBeTruthy();
    expect((await outbox({ to: cara, since })).filter((e) => e.subject === subject)).toHaveLength(0);
  });

  it('the unsubscribe link works, and the next campaign skips her', async () => {
    const since0 = new Date(Date.now() - 10 * 60_000).toISOString();
    const email = (await outbox({ to: ava, since: since0 })).find((e) => e.subject.startsWith('Open house'));
    const link = unsubscribeLink(email!.html)!;
    const page = await fetch(link, { headers: { 'x-staging-key': env.stagingKey } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('You are unsubscribed');
    const { data: sup } = await db.from('marketing_email_suppressions').select('reason').eq('lead_id', leadIds[ava]).maybeSingle();
    expect(sup?.reason).toBe('unsubscribe');
    const { data: row } = await db.from('leads').select('marketing_email_opt_in').eq('id', leadIds[ava]).single();
    expect(row!.marketing_email_opt_in).toBe(false);

    const since = new Date().toISOString();
    const subject = await sendCampaign('Winter tastings', [ava, ben]);
    await waitForEmail({ to: ben, since }, (e) => e.subject === subject);
    await new Promise((r) => setTimeout(r, 3000));
    expect((await outbox({ to: ava, since })).filter((e) => e.subject === subject)).toHaveLength(0);
  });

  it('the inbox’s one-click unsubscribe works too (RFC 8058)', async () => {
    const since0 = new Date(Date.now() - 10 * 60_000).toISOString();
    const email = (await outbox({ to: ben, since: since0 })).find((e) => e.subject.startsWith('Open house'));
    const link = unsubscribeLink(email!.html)!;
    const res = await fetch(link, { method: 'POST', headers: { 'x-staging-key': env.stagingKey }, body: 'List-Unsubscribe=One-Click' });
    expect(res.status).toBe(200);
    const { data: sup } = await db.from('marketing_email_suppressions').select('reason').eq('lead_id', leadIds[ben]).maybeSingle();
    expect(sup?.reason).toBe('one_click_unsubscribe');
  });

  it('resubscribing brings her back', async () => {
    const since0 = new Date(Date.now() - 10 * 60_000).toISOString();
    const email = (await outbox({ to: ava, since: since0 })).find((e) => e.subject.startsWith('Open house'));
    const resub = unsubscribeLink(email!.html)!.replace('/unsubscribe?', '/resubscribe?');
    const res = await fetch(resub, { headers: { 'x-staging-key': env.stagingKey } });
    expect(res.status).toBe(200);
    const { data: sup } = await db.from('marketing_email_suppressions').select('lead_id').eq('lead_id', leadIds[ava]).maybeSingle();
    expect(sup).toBeNull();
    const since = new Date().toISOString();
    const subject = await sendCampaign('Spring preview', [ava]);
    await waitForEmail({ to: ava, since }, (e) => e.subject === subject);
  });

  it('a bounce or a spam complaint from Resend stops further campaigns to that address', async () => {
    const report = (type: string, email: string) => fetch(`${env.base}/api/webhooks/resend?secret=${encodeURIComponent(env.password)}`, {
      method: 'POST',
      headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        type,
        data: { to: [email], email_id: `test-${runId}-${type}`, headers: [{ name: 'X-Venue-Id', value: FLOW_VENUE.id }, { name: 'X-Lead-Id', value: leadIds[email] }] },
      }),
    });
    expect((await fetch(`${env.base}/api/webhooks/resend?secret=wrong`, { method: 'POST', headers: { 'x-staging-key': env.stagingKey }, body: '{}' })).status).toBe(401);
    expect((await report('email.bounced', cara)).status).toBe(200);
    const since = new Date().toISOString();
    const subject = await sendCampaign('After the bounce', [cara, ava]);
    await waitForEmail({ to: ava, since }, (e) => e.subject === subject);
    await new Promise((r) => setTimeout(r, 3000));
    expect((await outbox({ to: cara, since })).filter((e) => e.subject === subject)).toHaveLength(0);

    expect((await report('email.complained', ava)).status).toBe(200);
    const since2 = new Date().toISOString();
    const subject2 = await sendCampaign('After the complaint', [ava]);
    await new Promise((r) => setTimeout(r, 5000));
    expect((await outbox({ to: ava, since: since2 })).filter((e) => e.subject === subject2)).toHaveLength(0);
  });
});
