import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, FLOW_VENUE, runId, signedInOwner, submitListingLead } from './helpers';

// The everyday work in the dashboard, through the same routes its screens use:
// each thing is created, changed and removed, and the database is checked.
// (Reading every page and route is covered by the sweeps.)

const ok = async (res: Response, what: string) => {
  expect(res.status, `${what}: ${res.status} ${res.status >= 300 ? await res.clone().text() : ''}`).toBeLessThan(300);
  return res.json().catch(() => ({})) as Promise<Record<string, unknown>>;
};
/** The id in a create response, whatever it's wrapped in. */
const idOf = (body: Record<string, unknown>): string => {
  for (const v of [body.id, ...Object.values(body).map((x) => (x && typeof x === 'object' ? (x as { id?: unknown }).id : undefined))]) {
    if (typeof v === 'string') return v;
  }
  throw new Error(`no id in ${JSON.stringify(body).slice(0, 200)}`);
};

describe('everyday dashboard work', () => {
  let owner: Browser;
  let leadId = '';

  beforeAll(async () => {
    owner = await signedInOwner();
    const res = await submitListingLead({
      venue_id: FLOW_VENUE.id, first_name: 'Eve', last_name: 'Everyday', email: `eve.${runId}@example.com`,
      phone: `(332) 560-${(parseInt(runId.slice(-5), 36) % 9000) + 1000}`, source: 'directory', client_ip: '203.0.113.81',
    });
    expect(res.status).toBe(201);
    leadId = ((await res.json()) as { lead_id: string }).lead_id;
  });

  it('a lead: edit it, add a note and a task, finish the task, delete both', async () => {
    await ok(await owner.fetch(`/api/leads/${leadId}`, { method: 'PATCH', json: { notes: `Prefers Saturdays ${runId}` } }), 'edit lead');
    expect((await db.from('leads').select('notes').eq('id', leadId).single()).data!.notes).toContain(runId);

    const note = await ok(await owner.fetch(`/api/leads/${leadId}/notes`, { method: 'POST', json: { content: `Called her ${runId}` } }), 'add note');
    const noteId = idOf(note);
    expect(JSON.stringify(await ok(await owner.fetch(`/api/leads/${leadId}/notes`), 'notes'))).toContain(`Called her ${runId}`);
    await ok(await owner.fetch(`/api/leads/${leadId}/notes/${noteId}`, { method: 'DELETE' }), 'delete note');

    const task = await ok(await owner.fetch(`/api/leads/${leadId}/tasks`, { method: 'POST', json: { title: `Send floor plan ${runId}`, dueAt: new Date(Date.now() + 86_400_000).toISOString() } }), 'add task');
    const taskId = idOf(task);
    await ok(await owner.fetch(`/api/leads/${leadId}/tasks/${taskId}`, { method: 'PATCH', json: { completed: true, done: true, status: 'done' } }), 'finish task');
    await ok(await owner.fetch(`/api/leads/${leadId}/tasks/${taskId}`, { method: 'DELETE' }), 'delete task');
    await ok(await owner.fetch(`/api/leads/${leadId}/timeline`), 'timeline');
  });

  it('a pipeline with a stage: create, rename, delete', async () => {
    const p = await ok(await owner.fetch('/api/pipelines', { method: 'POST', json: { name: `Weddings ${runId}` } }), 'create pipeline');
    // The answer is the venue's whole pipeline list.
    const pipelineId = (p.pipelines as Array<{ id: string; name: string }>).find((x) => x.name === `Weddings ${runId}`)!.id;
    await ok(await owner.fetch(`/api/pipelines/${pipelineId}/stages`, { method: 'POST', json: { name: `Deposit paid ${runId}` } }), 'add stage');
    const { data: stages } = await db.from('lead_pipeline_stages').select('name').eq('pipeline_id', pipelineId);
    expect(stages!.map((s) => s.name)).toContain(`Deposit paid ${runId}`);
    await ok(await owner.fetch(`/api/pipelines/${pipelineId}`, { method: 'PATCH', json: { name: `Weddings 2027 ${runId}` } }), 'rename pipeline');
    await ok(await owner.fetch(`/api/pipelines/${pipelineId}`, { method: 'DELETE' }), 'delete pipeline');
  });

  it('a contact: create, edit, note, delete', async () => {
    const c = await ok(await owner.fetch('/api/venue-customers', {
      method: 'POST', json: { customer_email: `cora.${runId}@example.com`, first_name: 'Cora', last_name: 'Contact', phone: '(212) 555-0182' },
    }), 'create contact');
    const id = idOf(c);
    await ok(await owner.fetch(`/api/venue-customers/${id}`, { method: 'PATCH', json: { last_name: 'Contacted' } }), 'edit contact');
    expect((await db.from('venue_customers').select('last_name').eq('id', id).single()).data!.last_name).toBe('Contacted');
    await ok(await owner.fetch(`/api/venue-customers/${id}/notes`, { method: 'POST', json: { content: `Met at the fair ${runId}` } }), 'contact note');
    await ok(await owner.fetch(`/api/venue-customers/${id}`, { method: 'DELETE' }), 'delete contact');
  });

  it('a calendar event: create, move, delete', async () => {
    const start = new Date(Date.now() + 10 * 86_400_000);
    const e = await ok(await owner.fetch('/api/calendar', {
      method: 'POST', json: { title: `Tasting ${runId}`, event_type: 'tasting', start_at: start.toISOString(), end_at: new Date(start.getTime() + 3_600_000).toISOString() },
    }), 'create event');
    const id = idOf(e);
    const later = new Date(start.getTime() + 86_400_000);
    await ok(await owner.fetch(`/api/calendar/${id}`, { method: 'PATCH', json: { start_at: later.toISOString(), end_at: new Date(later.getTime() + 3_600_000).toISOString() } }), 'move event');
    expect(Date.parse((await db.from('calendar_events').select('start_at').eq('id', id).single()).data!.start_at)).toBe(later.getTime());
    await ok(await owner.fetch(`/api/calendar/${id}`, { method: 'DELETE' }), 'delete event');
  });

  it('offerings: a space, a package, a coupon and a product', async () => {
    const space = idOf(await ok(await owner.fetch('/api/spaces', { method: 'POST', json: { name: `Garden ${runId}`, capacity: 150 } }), 'create space'));
    await ok(await owner.fetch(`/api/spaces/${space}`, { method: 'PATCH', json: { capacity: 175 } }), 'edit space');
    await ok(await owner.fetch(`/api/spaces/${space}`, { method: 'DELETE' }), 'delete space');

    const pkg = idOf(await ok(await owner.fetch('/api/venue-packages', { method: 'POST', json: { name: `Full day ${runId}`, lines: [] } }), 'create package'));
    await ok(await owner.fetch(`/api/venue-packages/${pkg}`, { method: 'DELETE' }), 'delete package');

    const coupon = idOf(await ok(await owner.fetch('/api/venue-coupons', {
      method: 'POST', json: { code: `SAVE${runId}`.toUpperCase().slice(0, 20), name: 'Ten off', discount_type: 'percent', discount_percent: 10 },
    }), 'create coupon'));
    await ok(await owner.fetch(`/api/venue-coupons/${coupon}`, { method: 'DELETE' }), 'delete coupon');

    const product = idOf(await ok(await owner.fetch('/api/products', { method: 'POST', json: { name: `Chair rental ${runId}`, price: 500 } }), 'create product'));
    await ok(await owner.fetch(`/api/products/${product}`, { method: 'DELETE' }), 'delete product');
  });

  it('a proposal template: create, read, delete', async () => {
    const t = idOf(await ok(await owner.fetch('/api/templates', { method: 'POST', json: { name: `Standard ${runId}`, content: '<p>Our standard package.</p>', fields: [] } }), 'create template'));
    expect(JSON.stringify(await ok(await owner.fetch(`/api/templates/${t}`), 'read template'))).toContain('standard package');
    await ok(await owner.fetch(`/api/templates/${t}`, { method: 'DELETE' }), 'delete template');
  });

  it('marketing: a tag and a saved audience', async () => {
    const tag = idOf(await ok(await owner.fetch('/api/marketing/tags', { method: 'POST', json: { name: `VIP ${runId}` } }), 'create tag'));
    await ok(await owner.fetch(`/api/marketing/tags/${tag}`, { method: 'PATCH', json: { name: `VIP+ ${runId}` } }), 'rename tag');
    await ok(await owner.fetch(`/api/marketing/tags/${tag}`, { method: 'DELETE' }), 'delete tag');
    const definition = { type: 'all_leads' };
    await ok(await owner.fetch('/api/marketing/segments/preview', { method: 'POST', json: { definition } }), 'preview audience');
    const seg = idOf(await ok(await owner.fetch('/api/marketing/segments', { method: 'POST', json: { name: `Everyone ${runId}`, definition } }), 'save audience'));
    await ok(await owner.fetch(`/api/marketing/segments/${seg}`, { method: 'DELETE' }), 'delete audience');
  });

  it('settings: profile, notifications and email templates load and save', async () => {
    await ok(await owner.fetch('/api/profile'), 'profile');
    const notifications = await ok(await owner.fetch('/api/profile/notifications'), 'notification settings');
    await ok(await owner.fetch('/api/profile/notifications', { method: 'PUT', json: notifications }), 'save notification settings');
    await ok(await owner.fetch('/api/email-templates'), 'email templates');
  });

  it('exports: contacts and accounting come out as CSV', async () => {
    for (const path of ['/api/contacts/export', '/api/accounting/export']) {
      const res = await owner.fetch(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type') ?? '', path).toMatch(/csv|text|spreadsheet|octet/);
      expect((await res.text()).length, path).toBeGreaterThan(10);
    }
  });
});
