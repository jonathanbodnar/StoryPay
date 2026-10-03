import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { env, runId } from './helpers';

// The Wedding Planner's tools, saved and read back the way the screens do:
// budget, checklist, timeline, vendors, and seating (tables + who sits where).
// Two couples, so one can never touch the other's plan.
describe('the Wedding Planner tools', () => {
  const couples = [0, 1].map((i) => ({
    email: `planner.${i}.${runId}@example.com`,
    password: `Planner-${i}-${runId}-2027!`,
    token: '',
  }));

  const api = (i: number, path: string, init: { method?: string; json?: unknown } = {}) =>
    fetch(`${env.base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'x-staging-key': env.stagingKey, authorization: `Bearer ${couples[i].token}`,
        ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    });

  beforeAll(async () => {
    const anon = createClient(env.supabaseUrl, String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY), { auth: { persistSession: false } });
    for (const [i, c] of couples.entries()) {
      const res = await fetch(`${env.base}/api/couple/signup`, {
        method: 'POST', headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' },
        body: JSON.stringify({ email: c.email, password: c.password, first_name: `Plan${i}`, last_name: 'Ner', phone: `(646) 57${i}-${(parseInt(runId.slice(-5), 36) % 9000) + 1000}` }),
      });
      expect(res.status, await res.clone().text()).toBe(200);
      const auth = await anon.auth.signInWithPassword({ email: c.email, password: c.password });
      if (auth.error) throw new Error(auth.error.message);
      c.token = auth.data.session!.access_token;
    }
  });

  it('the budget saves lines and the target, and junk is cleaned, not kept', async () => {
    const put = await api(0, '/api/couple/budget', {
      method: 'PUT',
      json: { budget: { rev: 0, target: 42_000, lines: [
        { id: 'b1', category: 'Venue', label: '', estimated: 18_000, actual: 17_500, paid: true, note: 'Deposit in' },
        { id: 'b2', category: 'Catering', label: 'Dinner', estimated: 9_000, actual: 0, paid: false },
        { id: 'b3', category: 'NOT-A-CATEGORY', label: 'x', estimated: 9e12, actual: -5, paid: false },
      ] } },
    });
    expect(put.status, await put.clone().text()).toBe(200);
    const budget = ((await (await api(0, '/api/couple/budget')).json()) as { budget: { rev: number; target: number; lines: Array<Record<string, unknown>> } }).budget;
    expect(budget.rev).toBe(1);
    expect(budget.target).toBe(42_000);
    expect(budget.lines.find((l) => l.id === 'b1')).toMatchObject({ category: 'Venue', estimated: 18_000, actual: 17_500, paid: true });
    const junk = budget.lines.find((l) => l.id === 'b3');
    if (junk) {
      expect(junk.category).not.toBe('NOT-A-CATEGORY');
      expect(Number(junk.estimated)).toBeLessThanOrEqual(100_000_000);
      expect(Number(junk.actual)).toBeGreaterThanOrEqual(0);
    }
    // The other couple's budget is untouched.
    expect(((await (await api(1, '/api/couple/budget')).json()) as { budget: { lines: unknown[] } }).budget.lines).toHaveLength(0);
  });

  it('the checklist, timeline and vendors save and read back', async () => {
    const checklist = await api(0, '/api/couple/checklist', {
      method: 'PUT', json: { checklist: { rev: 0, items: [
        { id: 'c1', title: `Book the florist ${runId}`, dueDate: '2027-03-01', done: false },
        { id: 'c2', title: 'Send save-the-dates', dueDate: '', done: true },
      ] } },
    });
    expect(checklist.status, await checklist.clone().text()).toBe(200);
    const items = ((await (await api(0, '/api/couple/checklist')).json()) as { checklist: { items: Array<{ title: string; done: boolean }> } }).checklist.items;
    expect(items.map((i) => i.title)).toContain(`Book the florist ${runId}`);
    expect(items.find((i) => i.title === 'Send save-the-dates')!.done).toBe(true);

    const timeline = await api(0, '/api/couple/timeline', {
      method: 'PUT', json: { timeline: { rev: 0, events: [
        { id: 't1', time: '15:30', title: 'Ceremony' },
        { id: 't2', time: '18:00', title: `Dinner ${runId}`, note: 'Barn doors open' },
        { id: 't3', time: '99:99', title: 'Bad time' },
      ] } },
    });
    expect(timeline.status, await timeline.clone().text()).toBe(200);
    const events = ((await (await api(0, '/api/couple/timeline')).json()) as { timeline: { events: Array<{ time: string; title: string }> } }).timeline.events;
    expect(events.find((e) => e.title === 'Ceremony')!.time).toBe('15:30');
    const bad = events.find((e) => e.title === 'Bad time');
    if (bad) expect(bad.time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$|^$/); // cleaned to a real time or cleared

    const vendors = await api(0, '/api/couple/vendors', {
      method: 'PUT', json: { vendors: { rev: 0, items: [
        { id: 'v1', category: 'Photographer', businessName: `Light & Lens ${runId}`, contactName: 'Sam', phone: '(212) 555-0190', email: `photo.${runId}@example.com` },
      ] } },
    });
    expect(vendors.status, await vendors.clone().text()).toBe(200);
    const list = ((await (await api(0, '/api/couple/vendors')).json()) as { vendors: { items: Array<{ businessName: string; category: string }> } }).vendors.items;
    expect(list.find((v) => v.businessName === `Light & Lens ${runId}`)!.category).toBe('Photographer');

    // All three stayed out of the other couple's plan.
    for (const [path, key] of [['/api/couple/checklist', 'checklist'], ['/api/couple/timeline', 'timeline'], ['/api/couple/vendors', 'vendors']] as const) {
      const theirs = (await (await api(1, path)).json()) as Record<string, { items?: unknown[]; events?: unknown[] }>;
      expect([...(theirs[key].items ?? []), ...(theirs[key].events ?? [])]).toHaveLength(0);
    }
  });

  it('seating: tables are made, a guest is seated, and deleting the table un-seats them', async () => {
    const made = await api(0, '/api/couple/tables', { method: 'POST', json: { name: `Head table ${runId}`, capacity: 10 } });
    expect(made.status, await made.clone().text()).toBeLessThan(300);
    const tables = (await (await api(0, '/api/couple/tables')).json()) as { tables?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>;
    const list = Array.isArray(tables) ? tables : tables.tables ?? [];
    const table = list.find((t) => t.name === `Head table ${runId}`)!;
    expect(table).toBeTruthy();

    const added = await api(0, '/api/couple/guests', { method: 'POST', json: { full_name: 'Sidney Seated', party_size: 2 } });
    expect(added.status, await added.clone().text()).toBeLessThan(300);
    const guests = (await (await api(0, '/api/couple/guests')).json()) as { guests?: Array<{ id: string; full_name: string }> };
    const guest = (guests.guests ?? []).find((g) => g.full_name === 'Sidney Seated')!;

    const seated = await api(0, `/api/couple/guests/${guest.id}`, { method: 'PATCH', json: { table_id: table.id } });
    expect(seated.status, await seated.clone().text()).toBeLessThan(300);

    // The other couple can't seat their guest at this couple's table, and
    // can't rename or delete the table.
    const theirGuest = await api(1, '/api/couple/guests', { method: 'POST', json: { full_name: 'Gate Crasher', party_size: 1 } });
    expect(theirGuest.status).toBeLessThan(300);
    const theirs = ((await (await api(1, '/api/couple/guests')).json()) as { guests?: Array<{ id: string; full_name: string }> }).guests!.find((g) => g.full_name === 'Gate Crasher')!;
    expect((await api(1, `/api/couple/guests/${theirs.id}`, { method: 'PATCH', json: { table_id: table.id } })).status).toBe(400);
    expect([400, 403, 404]).toContain((await api(1, `/api/couple/tables/${table.id}`, { method: 'PATCH', json: { name: 'Mine now' } })).status);
    expect([400, 403, 404]).toContain((await api(1, `/api/couple/tables/${table.id}`, { method: 'DELETE' })).status);

    // Deleting the table un-seats the guest instead of deleting them.
    expect((await api(0, `/api/couple/tables/${table.id}`, { method: 'DELETE' })).status).toBeLessThan(300);
    const after = ((await (await api(0, '/api/couple/guests')).json()) as { guests?: Array<{ full_name: string; table_id: string | null }> }).guests!;
    const sidney = after.find((g) => g.full_name === 'Sidney Seated')!;
    expect(sidney).toBeTruthy();
    expect(sidney.table_id).toBeNull();
  });
});
