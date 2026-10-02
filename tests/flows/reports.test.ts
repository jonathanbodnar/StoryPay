import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, runId } from './helpers';

// The dashboard's numbers and the Reports page, on a fresh venue whose records
// are known: they count exactly what was added (cancelled bookings left out),
// and every report opens.
describe('dashboard numbers and reports', () => {
  const email = `reports.${runId}@example.com`;
  const n = (parseInt(runId.slice(-5), 36) % 9000) + 1000;
  const owner = new Browser();
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  const stats = async () => {
    const res = await owner.fetch(`/api/dashboard/stats?from=${ymd(day(-1))}&to=${ymd(day(120))}`);
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as { leadCount: number; toursBooked: number; weddingsBooked: number; proposalCount: number; totalRevenue: number };
  };

  beforeAll(async () => {
    const res = await owner.fetch('/api/auth/signup', {
      method: 'POST', json: { venue_name: `Reports Barn ${runId}`, first_name: 'Rory', last_name: 'Ports', email, phone: '(212) 555-0166', password: `Reports-${runId}-Barn-2027!` },
    });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('a new venue starts at zero', async () => {
    expect(await stats()).toMatchObject({ leadCount: 0, toursBooked: 0, weddingsBooked: 0, proposalCount: 0, totalRevenue: 0 });
  });

  it('counts the leads, tours and weddings added, and not a cancelled one', async () => {
    for (const [i, first] of ['Nora', 'Owen'].entries()) {
      const lead = await owner.fetch('/api/leads', {
        method: 'POST', json: { firstName: first, lastName: 'Numbers', email: `${first.toLowerCase()}.reports.${runId}@example.com`, phone: `(646) 56${2 + i}-${n}` },
      });
      expect(lead.status, await lead.clone().text()).toBeLessThan(300);
    }
    const event = async (event_type: string, status: string, offset: number) => {
      const start = day(offset);
      const res = await owner.fetch('/api/calendar', {
        method: 'POST', json: { title: `${event_type} ${runId}`, event_type, status, start_at: start.toISOString(), end_at: new Date(start.getTime() + 3_600_000).toISOString() },
      });
      expect(res.status, await res.clone().text()).toBeLessThan(300);
    };
    await event('tour', 'confirmed', 5);
    await event('wedding', 'confirmed', 60);
    await event('wedding', 'cancelled', 61);
    expect(await stats()).toMatchObject({ leadCount: 2, toursBooked: 1, weddingsBooked: 1 });
  });

  it('every report opens', async () => {
    for (const type of ['revenue', 'proposals', 'customers', 'aging', 'payment-methods', 'refunds']) {
      const res = await owner.fetch(`/api/reports?type=${type}&from=${ymd(day(-30))}&to=${ymd(day(1))}`);
      expect(res.status, `${type}: ${await res.clone().text()}`).toBe(200);
    }
    expect((await owner.fetch('/api/reports/crm-summary')).status).toBe(200);
    expect((await owner.fetch('/api/dashboard/booking-trends')).status).toBe(200);
  });
});
