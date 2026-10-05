import { describe, expect, it } from 'vitest';
import { Browser, signedInSuperAdmin } from './helpers';

// Support Analytics → "Funnel Health by Plan Type": every venue's leads, added
// up by the kind of plan the venue is on.
//
// Oct 5 2026: it stopped loading on the test copy, which keeps every test
// venue ever made, the moment there were 452 venues to ask about. The route
// put every venue's id into one request's address; past 16 KB that request is
// never sent. The live app would have met the same wall as venues were added.
// (The rule itself is held by tests/unit/in-batches.test.ts.)
describe('Support Analytics', () => {
  type Cohort = { key: string; label: string; venueCount: number; steps: Array<{ key: string; count: number }> };

  it('the funnels by plan load, however many venues there are', async () => {
    const admin = await signedInSuperAdmin();
    const res = await admin.fetch('/api/admin/support/cohort-funnels');
    expect(res.status, await res.clone().text()).toBe(200);
    const { cohorts } = (await res.json()) as { cohorts: Cohort[] };
    expect(cohorts.map((c) => c.key)).toEqual(['private_client', 'all_inclusive', 'saas_97']);
    for (const c of cohorts) {
      expect(c.steps.map((s) => s.key), c.key).toEqual(['leads', 'conversations', 'qualified', 'tours', 'weddings']);
      // A funnel only narrows: nobody books a tour who was never a lead.
      expect(c.steps[0].count, c.key).toBeGreaterThanOrEqual(c.steps[c.steps.length - 1].count);
    }
    // The flow tests' own venues are on the $97 plan, with leads.
    const saas = cohorts.find((c) => c.key === 'saas_97')!;
    expect(saas.venueCount).toBeGreaterThan(0);
    expect(saas.steps[0].count).toBeGreaterThan(0);
  });

  it('so does the list behind a number, and only for the team', async () => {
    const admin = await signedInSuperAdmin();
    const drill = await admin.fetch('/api/admin/support/cohort-funnels?cohort=saas_97&stage=leads');
    expect(drill.status, await drill.clone().text()).toBe(200);
    const { venues } = (await drill.json()) as { venues: Array<{ id: string; leadCount: number; countAtOrPastStage: number }> };
    expect(venues.length).toBeGreaterThan(0);
    expect(venues.every((v) => v.countAtOrPastStage > 0 && v.leadCount >= v.countAtOrPastStage)).toBe(true);

    expect((await new Browser().fetch('/api/admin/support/cohort-funnels')).status).toBe(401);
  });
});
