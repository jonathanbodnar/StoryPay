import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureFlowVenue, env, FLOW_VENUE, outbox, runId, submitListingLead, waitForEmail } from './helpers';

// A couple who already answered the venue gets no more "do you have a date?"
// follow-ups, and sending the form again doesn't re-send the guide (which asks
// for their date again). Reported by a venue on Oct 1, 2026.
describe('a couple who replies to the venue', () => {
  const email = `jordan.${runId}@example.com`;
  const clientIp = `198.51.100.${1 + (parseInt(runId.slice(-4), 36) % 250)}`;
  const form = {
    venue_id: FLOW_VENUE.id, first_name: 'jordan', last_name: 'lake', email, phone: '(212) 555-0177',
    guest_count: 80, message: 'Pricing please!', source: 'directory', client_ip: clientIp,
  };
  const guideSubject = `Your pricing guide from ${FLOW_VENUE.name}`;
  let leadId = '';
  let since = '';

  beforeAll(async () => {
    await ensureFlowVenue();
    since = new Date().toISOString();
  });

  it('gets the guide, then texts back', async () => {
    const res = await submitListingLead(form);
    expect(res.status).toBe(201);
    leadId = ((await res.json()) as { lead_id: string }).lead_id;
    await waitForEmail({ to: email, since }, (e) => e.subject === guideSubject);

    // Their text reply, stored the way the inbound sync stores one.
    const { data: vc } = await db.from('venue_customers').select('id').eq('venue_id', FLOW_VENUE.id).ilike('customer_email', email).single();
    const { data: th } = await db.from('conversation_threads').select('id').eq('venue_customer_id', vc!.id).limit(1).single();
    const { error } = await db.from('conversation_messages').insert({
      thread_id: th!.id, visibility: 'external', channel: 'sms', body: 'June 14, 2027!', sender_kind: 'contact',
    });
    expect(error).toBeNull();
    const { data: lead } = await db.from('leads').select('last_inbound_at').eq('id', leadId).single();
    expect(lead!.last_inbound_at).toBeTruthy();
  });

  it('their follow-up sequence stops instead of texting again', async () => {
    const { data: enrolled } = await db.from('marketing_automation_enrollments').select('id').eq('lead_id', leadId);
    expect(enrolled?.length ?? 0).toBeGreaterThan(0);
    // The next follow-up comes due now; the sequence job runs.
    await db.from('marketing_automation_enrollments').update({ next_run_at: new Date().toISOString() }).eq('lead_id', leadId).eq('status', 'active');
    const job = await fetch(`${env.base}/api/cron/marketing-email`, {
      headers: { 'x-staging-key': env.stagingKey, authorization: `Bearer ${process.env.MARKETING_CRON_SECRET}` },
    });
    expect(job.status).toBe(200);
    const { data: after } = await db.from('marketing_automation_enrollments').select('status, last_error').eq('lead_id', leadId);
    expect(after!.filter((e) => e.status === 'active')).toHaveLength(0);
    expect(after!.some((e) => e.last_error === 'stopped_on_reply')).toBe(true);
  });

  it('sending the form again re-sends no guide; the venue hears they asked again', async () => {
    await db.from('leads').update({ created_at: new Date(Date.now() - 2 * 3_600_000).toISOString() }).eq('id', leadId);
    const again = new Date().toISOString();
    expect((await submitListingLead({ ...form, message: 'Is June 14 open?' })).status).toBe(201);
    await waitForEmail({ to: FLOW_VENUE.email, since: again }, (e) => e.subject === `Jordan Lake asked again — ${FLOW_VENUE.name}`);
    await new Promise((r) => setTimeout(r, 3000));
    expect((await outbox({ to: email, since })).filter((e) => e.subject === guideSubject)).toHaveLength(1);
  });
});
