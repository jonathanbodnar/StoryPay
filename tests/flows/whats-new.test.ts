import { describe, expect, it } from 'vitest';
import { runId, signedInMasterAdmin, signedInOwner } from './helpers';

// What's New: an update the StoryVenue team publishes shows as new for a venue
// until they've looked, and the bell's count goes back to zero.
describe('What’s New', () => {
  it('a published update is new for the venue until seen', async () => {
    const owner = await signedInOwner();
    const master = await signedInMasterAdmin();
    const unread = async () => ((await (await owner.fetch('/api/changelog/unread-count')).json()) as { count: number }).count;

    expect((await owner.fetch('/api/changelog/mark-seen', { method: 'POST' })).status).toBeLessThan(300);
    expect(await unread()).toBe(0);
    // Released now (the server's clock, like the moment marked seen).
    await new Promise((r) => setTimeout(r, 100));
    const made = await master.fetch('/api/admin/changelog-entries', {
      method: 'POST', json: { title: `Seating charts ${runId}`, description: 'Plan tables by dragging guests.', category: 'feature' },
    });
    expect(made.status, await made.clone().text()).toBe(201);
    const { id } = (await made.json()) as { id: string };
    try {
      expect(await unread()).toBe(1);
      expect(JSON.stringify(await (await owner.fetch('/api/changelog')).json())).toContain(`Seating charts ${runId}`);
      expect((await owner.fetch('/api/changelog/mark-seen', { method: 'POST' })).status).toBeLessThan(300);
      expect(await unread()).toBe(0);
    } finally {
      await master.fetch(`/api/admin/changelog-entries/${id}`, { method: 'DELETE' });
    }
  });

  it('only the StoryVenue team can publish one', async () => {
    const owner = await signedInOwner();
    expect([401, 403]).toContain((await owner.fetch('/api/admin/changelog-entries', { method: 'POST', json: { title: 'x', description: 'x' } })).status);
  });
});
