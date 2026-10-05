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

  // Until Oct 4 2026 this made a proposal with no due date, which has nothing
  // to remind about: its reminder was (rightly) dropped, and the test passed
  // on the "signed contract" email that happened to arrive in time. It now
  // follows a real reminder, and only a reminder counts.
  it('signing schedules the payment reminders; one reaches the couple when it comes due, once', async () => {
    const couple = `reminder.${runId}@example.com`;
    const isReminder = (e: { subject: string }) => e.subject.startsWith('Payment overdue');
    const reminders = async () => {
      const { data, error } = await db.from('proposal_payment_reminders')
        .select('id, send_at, sent_at, due_at, installment_index, installment_amount_cents').eq('proposal_id', proposalId).order('send_at');
      expect(error).toBeNull();
      return data ?? [];
    };
    // $3,000 due in three days.
    const dueDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const made = await owner.fetch('/api/proposals', {
      method: 'POST',
      json: {
        overrideContent: '<p>Wedding at Flow Test Venue. Payment due soon.</p>', customerName: 'Remy Reminder', customerEmail: couple,
        price: 300000, paymentType: 'full', paymentConfig: { due_date: dueDate }, collectManually: true, requireSignature: true,
      },
    });
    expect(made.status, await made.clone().text()).toBe(201);
    const { id: proposalId, public_token: token } = (await made.json()) as { id: string; public_token: string };
    // Nothing is scheduled for a proposal nobody has signed.
    expect(await reminders()).toEqual([]);
    const signed = await fetch(`${env.base}/api/proposals/public/${token}/sign`, {
      method: 'POST', headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' },
      body: JSON.stringify({ signatureData: { signature_0: SIGNATURE }, consentAccepted: true }),
    });
    expect(signed.status, await signed.clone().text()).toBe(200);

    // Signing schedules them (in the background): each for after the due date.
    let scheduled = await reminders();
    for (const until = Date.now() + 20_000; !scheduled.length && Date.now() < until;) {
      await new Promise((r) => setTimeout(r, 500));
      scheduled = await reminders();
    }
    expect(scheduled.length, 'signing scheduled no payment reminders').toBeGreaterThan(0);
    for (const r of scheduled) {
      expect(r).toMatchObject({ installment_index: 0, installment_amount_cents: 300000, sent_at: null });
      expect(r.due_at.slice(0, 10) >= dueDate, r.due_at).toBe(true);
      expect(Date.parse(r.send_at)).toBeGreaterThan(Date.parse(r.due_at));
    }

    // Not due yet: the job sends nothing.
    const since = new Date().toISOString();
    expect((await runJob('payment-reminders')).status).toBe(200);
    await new Promise((r) => setTimeout(r, 2000));
    expect((await outbox({ to: couple, since })).filter(isReminder)).toEqual([]);

    // The first one comes due.
    expect((await db.from('proposal_payment_reminders').update({ send_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', scheduled[0].id)).error).toBeNull();
    expect((await runJob('payment-reminders')).status).toBe(200);
    const email = await waitForEmail({ to: couple, since }, isReminder);
    expect(email.subject).toContain('$3,000.00');
    expect(email.subject).toContain(FLOW_VENUE.name);
    expect(email.html).toContain(`/proposal/${token}`); // where they pay

    // Running again doesn't send it twice, and the later ones wait their turn.
    expect((await runJob('payment-reminders')).status).toBe(200);
    await new Promise((r) => setTimeout(r, 2000));
    expect((await outbox({ to: couple, since })).filter(isReminder)).toHaveLength(1);
    const after = await reminders();
    expect(after.filter((r) => r.sent_at).map((r) => r.id)).toEqual([scheduled[0].id]);
    expect(after).toHaveLength(scheduled.length);
  });

  it('the re-engagement drip and the other daily jobs run cleanly', async () => {
    for (const job of ['reengagement-drip', 'tag-sweep', 'private-client-monthly-reminder', 'ghl-contacts-sync', 'trial-sweep']) {
      const res = await runJob(job);
      expect(res.status, `${job}: ${await res.clone().text()}`).toBe(200);
      expect(await res.text(), job).not.toMatch(/"ok"\s*:\s*false/);
    }
  });
});
