import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, env, runId } from './helpers';

// The availability calendar a venue shares with couples: booked days in the
// venue's own time zone, repeating events included, cancelled ones and anything
// personal left out. (Until Oct 2 it worked in UTC: an evening wedding out west
// showed on the next day, and a booking on a month's last day didn't show at
// all, so a taken date looked free.)
describe('the public availability calendar', () => {
  const email = `avail.${runId}@example.com`;
  const coupleEmail = `avail.couple.${runId}@example.com`;
  const owner = new Browser();
  let venueId = '';

  const event = async (json: Record<string, unknown>) => {
    const res = await owner.fetch('/api/calendar', { method: 'POST', json: { event_type: 'wedding', status: 'confirmed', ...json } });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
  };
  const month = (id: string, m: number) => fetch(`${env.base}/api/availability/${id}?year=2027&month=${m}`, { headers: { 'x-staging-key': env.stagingKey } });
  const bookedIn = async (m: number) => {
    const res = await month(venueId, m);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { booked: Array<{ date: string }> };
    return { dates: [...new Set(body.booked.map((b) => b.date))].sort(), raw: JSON.stringify(body) };
  };

  beforeAll(async () => {
    const res = await owner.fetch('/api/auth/signup', {
      method: 'POST', json: { venue_name: `Avail Barn ${runId}`, first_name: 'Ava', last_name: 'Ail', email, phone: '(212) 555-0164', password: `Avail-${runId}-Barn-2027!` },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    venueId = (await db.from('venues').select('id').ilike('email', email).single()).data!.id;
    await db.from('venues').update({ timezone: 'America/Los_Angeles' }).eq('id', venueId);

    // Saturday June 12, 2027, 5 to 11pm in California (midnight to 6am UTC on the 13th).
    await event({ title: 'Evening wedding', customer_email: coupleEmail, start_at: '2027-06-13T00:00:00Z', end_at: '2027-06-13T06:00:00Z' });
    // All day on Wednesday June 30, the month's last day, saved the way the calendar saves it.
    await event({ title: 'Closed for floors', event_type: 'blocked', all_day: true, start_at: '2027-06-30T07:00:00Z', end_at: '2027-07-01T06:59:59.999Z' });
    // Saturday July 31, 4pm to 1am.
    await event({ title: 'Late wedding', start_at: '2027-07-31T23:00:00Z', end_at: '2027-08-01T08:00:00Z' });
    // A tasting every Tuesday from May 4, ten times (the last on July 6).
    await event({ title: 'Tasting', event_type: 'tasting', start_at: '2027-05-04T17:00:00Z', end_at: '2027-05-04T18:00:00Z', recurrence_rule: { freq: 'weekly', count: 10 } });
    // A wedding on June 19 that was cancelled.
    await event({ title: 'Cancelled wedding', status: 'cancelled', start_at: '2027-06-19T23:00:00Z', end_at: '2027-06-20T05:00:00Z' });
  });

  it('shows each booked day on the venue’s own calendar date', async () => {
    const june = await bookedIn(6);
    expect(june.dates).toEqual(['2027-06-01', '2027-06-08', '2027-06-12', '2027-06-15', '2027-06-22', '2027-06-29', '2027-06-30']);
    const july = await bookedIn(7);
    expect(july.dates).toEqual(['2027-07-06', '2027-07-31']);
    // The late wedding doesn't take August 1 too.
    expect((await bookedIn(8)).dates).toEqual([]);
  });

  it('never shows who booked or what it’s called', async () => {
    const { raw } = await bookedIn(6);
    expect(raw).not.toContain(coupleEmail);
    expect(raw).not.toContain('Evening wedding');
    expect(raw).not.toContain('Closed for floors');
  });

  it('a venue that doesn’t exist, or a month that doesn’t, is refused', async () => {
    expect((await month('00000000-0000-4000-8000-000000000000', 6)).status).toBe(404);
    expect((await month(venueId, 13)).status).toBe(400);
  });
});
