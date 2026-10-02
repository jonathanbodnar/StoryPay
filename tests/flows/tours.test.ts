import { beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from './helpers';
import { db, ensureFlowVenue, FLOW_VENUE, outbox, runId, runJob, signedInOwner, submitListingLead } from './helpers';

// A venue books a couple's tour from the lead's page: the lead moves to Tour
// Booked, the venue's "Booked Tour" sequence starts, and the couple's reminder
// goes out when it comes due.
describe('a venue books a tour for a couple', () => {
  const email = `blake.${runId}@example.com`;
  let owner: Browser;
  let leadId = '';
  let eventId = '';

  beforeAll(async () => {
    await ensureFlowVenue();
    owner = await signedInOwner();
    // The venue's Booking System has its "Booked Tour" sequence on (saved like the owner saves it).
    const saved = await owner.fetch('/api/listing/booking-system', {
      method: 'PATCH',
      json: {
        phase4Enabled: true,
        phase4Steps: [{ step_order: 0, step_type: 'send_sms', label: 'Tour booked', body: 'Hi {{first_name}}! Your tour at {{venue_name}} is booked. See you soon!' }],
      },
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const res = await submitListingLead({
      venue_id: FLOW_VENUE.id, first_name: 'blake', last_name: 'tour', email, phone: `(646) 559-${(parseInt(runId.slice(-5), 36) % 9000) + 1000}`,
      guest_count: 140, message: 'Can we see the barn?', source: 'directory', client_ip: `203.0.113.${1 + ((parseInt(runId.slice(-4), 36) + 31) % 250)}`,
    });
    expect(res.status).toBe(201);
    leadId = ((await res.json()) as { lead_id: string }).lead_id;
  });

  it('the lead moves to Tour Booked and the Booked Tour sequence starts', async () => {
    const start = new Date(Date.now() + 3 * 86_400_000);
    start.setUTCHours(18, 0, 0, 0);
    const booked = await owner.fetch(`/api/leads/${leadId}/appointments`, {
      method: 'POST',
      json: { start_at: start.toISOString(), end_at: new Date(start.getTime() + 3_600_000).toISOString(), event_type: 'tour' },
    });
    expect(booked.status, await booked.clone().text()).toBe(200);
    eventId = ((await booked.json()) as { event: { id: string } }).event.id;

    const { data: lead } = await db.from('leads').select('status, stage_id').eq('id', leadId).single();
    expect(lead!.status).toBe('tour_booked');
    const { data: stage } = await db.from('lead_pipeline_stages').select('name').eq('id', lead!.stage_id).single();
    expect(stage!.name).toMatch(/tour booked/i);

    const { data: auto } = await db.from('marketing_automations').select('id').eq('venue_id', FLOW_VENUE.id).eq('name', 'Booked Tour Sequence — Booking System').single();
    // It starts in the background, like moving the card by hand.
    let enrolled: unknown[] = [];
    for (let i = 0; i < 15 && enrolled.length === 0; i++) {
      if (i) await new Promise((r) => setTimeout(r, 1000));
      enrolled = (await db.from('marketing_automation_enrollments').select('id').eq('lead_id', leadId).eq('automation_id', auto!.id)).data ?? [];
    }
    expect(enrolled).toHaveLength(1);
  });

  it('the couple’s tour reminder goes out when it comes due', async () => {
    const { data: reminders } = await db.from('calendar_event_reminders').select('id, channel').eq('calendar_event_id', eventId).is('sent_at', null);
    const byEmail = (reminders ?? []).find((r) => r.channel === 'email' || r.channel == null);
    expect(byEmail, JSON.stringify(reminders)).toBeTruthy();
    const since = new Date().toISOString();
    await db.from('calendar_event_reminders').update({ send_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', byEmail!.id);
    expect((await runJob('appointment-reminders')).status).toBe(200);
    const { data: row } = await db.from('calendar_event_reminders').select('sent_at').eq('id', byEmail!.id).single();
    expect(row!.sent_at).toBeTruthy();
    expect((await outbox({ to: email, since })).length).toBeGreaterThan(0);
  });
});
