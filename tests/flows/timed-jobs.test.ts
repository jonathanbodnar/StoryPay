import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, env, FLOW_VENUE, outbox, runId, runJob, signedInOwner, waitForEmail } from './helpers';

// A drawn signature, as the signing page sends it.
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// What the timed jobs actually do (access.test.ts checks they're locked and
// run without errors). The test copy is quiet while the tests run, so jobs
// that email venue owners are safe to run here.
describe('what the timed jobs do', () => {
  let owner: Browser;

  beforeAll(async () => {
    owner = await signedInOwner();
  });

  it('a venue’s scheduled booking report goes out once, then waits for next month', async () => {
    const reportTo = `reports.${runId}@example.com`;
    const longAgo = new Date(Date.now() - 65 * 86_400_000).toISOString();
    await db.from('venues').update({ report_schedule_enabled: true, report_schedule_emails: [reportTo], report_schedule_next_at: longAgo }).eq('id', FLOW_VENUE.id);
    try {
      const since = new Date().toISOString();
      expect((await runJob('send-booking-reports')).status).toBe(200);
      await waitForEmail({ to: reportTo, since }, (e) => e.subject.startsWith('Bride Booking System™ Report'));
      const { data } = await db.from('venues').select('report_schedule_next_at').eq('id', FLOW_VENUE.id).single();
      const next = Date.parse(data!.report_schedule_next_at);
      expect(next).toBeGreaterThan(Date.now());
      expect(next - Date.now()).toBeLessThanOrEqual(30 * 86_400_000);
      // Running again sends nothing more (the months it missed don't each send).
      expect((await runJob('send-booking-reports')).status).toBe(200);
      await new Promise((r) => setTimeout(r, 2000));
      expect((await outbox({ to: reportTo, since })).filter((e) => e.subject.startsWith('Bride Booking System™ Report'))).toHaveLength(1);
    } finally {
      await db.from('venues').update({ report_schedule_enabled: false, report_schedule_emails: [], report_schedule_next_at: null }).eq('id', FLOW_VENUE.id);
    }
  });

  it('a payment reminder reaches the couple when it comes due, once', async () => {
    const couple = `reminder.${runId}@example.com`;
    const made = await owner.fetch('/api/proposals', {
      method: 'POST',
      json: {
        overrideContent: '<p>Wedding at Flow Test Venue. Payment plan.</p>', customerName: 'Remy Reminder', customerEmail: couple,
        price: 300000, paymentType: 'full', paymentConfig: {}, collectManually: true, requireSignature: true,
      },
    });
    expect(made.status, await made.clone().text()).toBe(201);
    const { id: proposalId, public_token: token } = (await made.json()) as { id: string; public_token: string };
    // Reminders are only for signed proposals.
    const signed = await fetch(`${env.base}/api/proposals/public/${token}/sign`, {
      method: 'POST', headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' },
      body: JSON.stringify({ signatureData: { signature_0: SIGNATURE }, consentAccepted: true }),
    });
    expect(signed.status, await signed.clone().text()).toBe(200);
    const { error } = await db.from('proposal_payment_reminders').insert({
      proposal_id: proposalId, venue_id: FLOW_VENUE.id, installment_index: 0, reminder_index: 0, due_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      send_at: new Date(Date.now() - 60_000).toISOString(), offset_days: 3, offset_hours: 0, offset_minutes: 0, installment_amount_cents: 100000,
    });
    expect(error).toBeNull();
    const since = new Date().toISOString();
    expect((await runJob('payment-reminders')).status).toBe(200);
    await waitForEmail({ to: couple, since }, () => true);
    expect((await runJob('payment-reminders')).status).toBe(200);
    await new Promise((r) => setTimeout(r, 2000));
    expect((await outbox({ to: couple, since })).length).toBe(1);
  });

  it('the re-engagement drip and the other daily jobs run cleanly', async () => {
    for (const job of ['reengagement-drip', 'tag-sweep', 'private-client-monthly-reminder', 'ghl-contacts-sync', 'trial-sweep']) {
      const res = await runJob(job);
      expect(res.status, `${job}: ${await res.clone().text()}`).toBe(200);
      expect(await res.text(), job).not.toMatch(/"ok"\s*:\s*false/);
    }
  });
});
