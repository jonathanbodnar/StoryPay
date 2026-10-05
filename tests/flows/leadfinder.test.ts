import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, env, FLOW_VENUE, runId, signedInOwner, waitForEmail } from './helpers';

// Each run's couples have their own phones: Lead Finder rightly treats the same
// phone as the same couple, so a number from an earlier run would match that lead.
const n = (parseInt(runId.slice(-5), 36) % 9000) + 1000;

// Lead Finder end to end: an inquiry forwarded to the venue's Lead Finder
// address is read and becomes a lead (once, however often it's delivered);
// one it can't be sure about waits in the review queue until the owner
// confirms it. The email arrives through the test copy's stand-in for
// Resend's received-email API (lib/staging-inbound.ts).
describe('Lead Finder: forwarded inquiries become leads', () => {
  let owner: Browser;
  let address = '';
  let since = '';

  async function deliver(email: { from: string; subject: string; text: string; message_id?: string; reply_to?: string }): Promise<void> {
    const stored = await fetch(`${env.base}/api/staging/inbound-email`, {
      method: 'POST', headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' },
      body: JSON.stringify({ ...email, to: [address] }),
    });
    expect(stored.status, await stored.clone().text()).toBe(200);
    const { email_id } = (await stored.json()) as { email_id: string };
    const hook = await fetch(`${env.base}/api/webhooks/inbound-email?token=${encodeURIComponent(process.env.INBOUND_EMAIL_WEBHOOK_TOKEN ?? '')}`, {
      method: 'POST', headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'email.received', data: { email_id } }),
    });
    expect(hook.status, await hook.clone().text()).toBe(200);
  }

  async function leadsWith(email: string, wait = 30_000): Promise<Array<{ id: string; first_name: string | null }>> {
    const until = Date.now() + wait;
    for (;;) {
      const { data } = await db.from('leads').select('id, first_name').eq('venue_id', FLOW_VENUE.id).eq('email', email);
      if ((data?.length ?? 0) > 0 || Date.now() > until) return data ?? [];
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  beforeAll(async () => {
    owner = await signedInOwner();
    since = new Date().toISOString();
    const res = await owner.fetch('/api/venue/leadfinder');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { configured: boolean; address: string | null };
    expect(body.configured).toBe(true);
    address = body.address!;
  });

  it('a marketplace inquiry becomes a lead, and the owner hears about it', async () => {
    const email = `lena.lf.${runId}@wedmail.test`;
    await deliver({
      from: 'The Knot <noreply@theknot.com>',
      subject: 'You have a new inquiry from Lena Forward',
      message_id: `<lf-${runId}-1@theknot.example.com>`,
      text: [
        'You have a new message!',
        'Name: Lena Forward',
        `E-mail: ${email}`,
        `Phone: (407) 556-${n}`,
        'Wedding Date: Saturday, June 12th, 2027',
        'Guest Count: 120',
        'Message: We love your barn and would like pricing for a June wedding.',
      ].join('\n'),
    });
    const leads = await leadsWith(email);
    expect(leads).toHaveLength(1);
    expect(leads[0].first_name?.toLowerCase()).toBe('lena');
    await waitForEmail({ to: FLOW_VENUE.email, since }, (e) => /Lena Forward/i.test(e.subject));
  });

  it('the same inquiry delivered again makes no second lead', async () => {
    const email = `lena.lf.${runId}@wedmail.test`;
    await deliver({
      from: 'The Knot <noreply@theknot.com>',
      subject: 'You have a new inquiry from Lena Forward',
      message_id: `<lf-${runId}-1@theknot.example.com>`,
      text: ['Name: Lena Forward', `E-mail: ${email}`, `Phone: (407) 556-${n}`, 'Wedding Date: Saturday, June 12th, 2027'].join('\n'),
    });
    await new Promise((r) => setTimeout(r, 4000));
    expect(await leadsWith(email, 0)).toHaveLength(1);
  });

  it('an inquiry that only gives a marketplace reply address waits for the owner, and becomes a lead once confirmed', async () => {
    const subject = `New message from Nora Review ${runId}`;
    await deliver({
      from: 'WeddingWire <messages@weddingwire.com>',
      reply_to: `reply-${runId}@messages.weddingwire.com`,
      subject,
      message_id: `<lf-${runId}-2@weddingwire.example.com>`,
      text: 'You have a new lead!\nName: Nora Review\nWedding Date: October 9, 2027\nGuests: 150\nMessage: Is October 2027 open?\nReply to this email to respond.',
    });
    const until = Date.now() + 30_000;
    let row: { id: string; lead_id: string | null } | null = null;
    while (!row && Date.now() < until) {
      const { data } = await db.from('leadfinder_imports').select('id, lead_id, review_state').eq('venue_id', FLOW_VENUE.id).eq('subject', subject).maybeSingle();
      if (data && data.review_state === 'needs_review') row = data;
      else await new Promise((r) => setTimeout(r, 2000));
    }
    expect(row, 'the import should wait in the review queue').not.toBeNull();
    const queue = await owner.fetch('/api/venue/leadfinder/review');
    expect(queue.status).toBe(200);
    expect(JSON.stringify(await queue.json())).toContain(row!.id);
    const email = `nora.lf.${runId}@wedmail.test`;
    const confirm = await owner.fetch(`/api/venue/leadfinder/review/${row!.id}`, {
      method: 'POST', json: { action: 'confirm', fields: { name: 'Nora Review', email, phone: `(407) 557-${n}` } },
    });
    expect(confirm.status, await confirm.clone().text()).toBe(200);
    expect(await leadsWith(email)).toHaveLength(1);
  });

  it('mail to a forged Lead Finder address is ignored', async () => {
    const forged = address.replace(/\+[0-9a-f]{16}@/, '+0000000000000000@');
    const stored = await fetch(`${env.base}/api/staging/inbound-email`, {
      method: 'POST', headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'x@example.com', to: [forged], subject: 'Forged', text: `Name: Fake Person\nE-mail: forged.${runId}@wedmail.test` }),
    });
    const { email_id } = (await stored.json()) as { email_id: string };
    await fetch(`${env.base}/api/webhooks/inbound-email?token=${encodeURIComponent(process.env.INBOUND_EMAIL_WEBHOOK_TOKEN ?? '')}`, {
      method: 'POST', headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'email.received', data: { email_id } }),
    });
    await new Promise((r) => setTimeout(r, 3000));
    expect(await leadsWith(`forged.${runId}@wedmail.test`, 0)).toHaveLength(0);
  });
});
