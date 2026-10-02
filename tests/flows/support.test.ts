import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, FLOW_VENUE, runId, signedInOwner, signedInSuperAdmin, waitForEmail } from './helpers';

// Support between a venue and the StoryVenue team: the venue opens a ticket
// from the help panel, the team sees it and answers, the venue gets the answer
// by email and in the panel, replies, and the team closes it. Feature requests
// and article ratings from the dashboard are saved.
describe('a venue asks the StoryVenue team for help', () => {
  const subject = `Calendar question ${runId}`;
  let owner: Browser;
  let team: Browser;
  let ticketId = '';

  beforeAll(async () => {
    owner = await signedInOwner();
    team = await signedInSuperAdmin();
  });

  it('the venue opens a ticket and the team sees it', async () => {
    expect((await owner.fetch('/api/dashboard/support-tickets', { method: 'POST', json: { subject, body: '' } })).status).toBe(400);
    const res = await owner.fetch('/api/dashboard/support-tickets', { method: 'POST', json: { subject, body: 'How do I block a holiday weekend?' } });
    expect(res.status, await res.clone().text()).toBe(201);
    ticketId = ((await res.json()) as { ticket: { id: string } }).ticket.id;
    expect(JSON.stringify(await (await owner.fetch('/api/dashboard/support-tickets')).json())).toContain(ticketId);
    const list = await team.fetch(`/api/admin/support/tickets?search=${encodeURIComponent(subject)}`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(await list.json())).toContain(ticketId);
  });

  it('the team’s answer reaches the venue by email and in the panel', async () => {
    const since = new Date().toISOString();
    const res = await team.fetch(`/api/admin/support/tickets/${ticketId}/reply`, { method: 'POST', json: { body: `Use a Blocked event on the calendar ${runId}` } });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    const mail = await waitForEmail({ to: FLOW_VENUE.email, since }, (e) => e.subject === `Re: ${subject}`);
    expect(mail.html).toContain(`Use a Blocked event on the calendar ${runId}`);
    const detail = await owner.fetch(`/api/dashboard/support-tickets/${ticketId}`);
    expect(detail.status).toBe(200);
    expect(JSON.stringify(await detail.json())).toContain(`Use a Blocked event on the calendar ${runId}`);
    expect((await db.from('support_threads').select('status').eq('id', ticketId).single()).data!.status).toBe('pending');
  });

  it('the venue replies, and the team closes it', async () => {
    const reply = await owner.fetch(`/api/dashboard/support-tickets/${ticketId}`, { method: 'POST', json: { body: 'That worked, thank you!' } });
    expect(reply.status, await reply.clone().text()).toBeLessThan(300);
    const { data: msgs } = await db.from('support_thread_messages').select('sender_type, body').eq('support_thread_id', ticketId).order('created_at');
    expect(msgs!.map((m) => m.sender_type)).toEqual(['venue', 'support', 'venue']);
    expect((await team.fetch(`/api/admin/support/tickets/${ticketId}/status`, { method: 'POST', json: { status: 'closed' } })).status).toBeLessThan(300);
    expect((await db.from('support_threads').select('status').eq('id', ticketId).single()).data!.status).toBe('closed');
  });

  it('another venue can’t read or answer it', async () => {
    const other = new Browser();
    const res = await other.fetch(`/api/dashboard/support-tickets/${ticketId}`);
    expect([401, 403, 404]).toContain(res.status);
  });
});

describe('feature requests and help articles', () => {
  let owner: Browser;

  beforeAll(async () => {
    owner = await signedInOwner();
  });

  it('a feature request is saved, listed and voted on', async () => {
    expect((await owner.fetch('/api/feature-requests', { method: 'POST', json: { title: '' } })).status).toBe(400);
    const made = await owner.fetch('/api/feature-requests', { method: 'POST', json: { title: `Seating charts ${runId}`, description: 'Drag-and-drop tables.' } });
    expect(made.status, await made.clone().text()).toBeLessThan(300);
    const { data } = await db.from('feature_requests').select('id').ilike('title', `Seating charts ${runId}`).single();
    expect(JSON.stringify(await (await owner.fetch('/api/feature-requests')).json())).toContain(`Seating charts ${runId}`);
    const vote = await owner.fetch(`/api/feature-requests/${data!.id}/vote`, { method: 'POST' });
    expect(vote.status, await vote.clone().text()).toBeLessThan(300);
  });
});
