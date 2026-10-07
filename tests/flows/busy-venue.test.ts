import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, env, runId } from './helpers';

// A venue with many leads. Two walls were waiting for one:
//  - a list of ids past about 430 is too long to ask the database about in one
//    request (lib/in-batches). The Lead Inbox asked about every lead at once
//    for tags, note counts and duplicate warnings, got an error it didn't show,
//    and drew every lead without them; a campaign to a tag held by more leads
//    than that had an audience of nobody.
//  - the database answers with 1,000 rows at most. A campaign to "all leads"
//    reached the first thousand and said nothing.
// Here a venue has 1,100 leads, all with one tag.
describe('a venue with more than a thousand leads', () => {
  const venueId = randomUUID();
  const email = `busy-leads.${runId}@example.com`;
  const MANY = 1100;
  const leads = Array.from({ length: MANY }, (_, n) => ({ id: randomUUID(), n }));
  let owner: Browser;
  let tagId = '';

  const inChunks = async <T,>(rows: T[], insert: (chunk: T[]) => PromiseLike<{ error: { message: string } | null }>, what: string) => {
    for (let i = 0; i < rows.length; i += 400) {
      const { error } = await insert(rows.slice(i, i + 400));
      if (error) throw new Error(`${what}: ${error.message}`);
    }
  };

  beforeAll(async () => {
    const made = await db.from('venues').insert({
      id: venueId, name: `Busy Leads ${runId}`, slug: `busy-leads-${runId}`, email, notification_email: email, brand_email: email,
      password_hash: await bcrypt.hash(env.password, 10), setup_completed: true, onboarding_status: 'registered',
      onboarding_completed_at: new Date().toISOString(), email_verified_at: new Date().toISOString(), timezone: 'America/New_York',
    });
    if (made.error) throw new Error(`venue: ${made.error.message}`);
    const now = Date.now();
    await inChunks(leads, (chunk) => db.from('leads').insert(chunk.map((l) => ({
      id: l.id, venue_id: venueId, name: `Busy Lead${l.n}`, first_name: 'Busy', last_name: `Lead${l.n}`,
      email: `busy-lead.${l.n}.${runId}@example.com`, source: 'directory', created_at: new Date(now - l.n * 1000).toISOString(),
    }))), 'leads');
    const tag = await db.from('marketing_tags').insert({ venue_id: venueId, name: `Everyone ${runId}` }).select('id').single();
    if (tag.error) throw new Error(`tag: ${tag.error.message}`);
    tagId = tag.data!.id;
    await inChunks(leads, (chunk) => db.from('lead_tag_assignments').insert(chunk.map((l) => ({ lead_id: l.id, tag_id: tagId, venue_id: venueId }))), 'tags');
    // The newest lead has two notes, and a duplicate warning against the next.
    const notes = await db.from('lead_notes').insert([
      { venue_id: venueId, lead_id: leads[0].id, content: 'Called, left a message', author_name: 'Owner' },
      { venue_id: venueId, lead_id: leads[0].id, content: 'She called back', author_name: 'Owner' },
    ]);
    if (notes.error) throw new Error(`notes: ${notes.error.message}`);
    const dup = await db.from('lead_duplicate_candidates').insert({ venue_id: venueId, lead_id: leads[0].id, matches_lead_id: leads[1].id, reason: 'same_phone', status: 'open' });
    if (dup.error) throw new Error(`duplicate: ${dup.error.message}`);
    owner = new Browser();
    await owner.signIn(email);
  }, 180_000);

  afterAll(async () => {
    // Leave nothing behind: a thousand leads would slow every later run.
    await db.from('lead_duplicate_candidates').delete().eq('venue_id', venueId);
    await db.from('lead_notes').delete().eq('venue_id', venueId);
    await db.from('lead_tag_assignments').delete().eq('venue_id', venueId);
    await db.from('marketing_tags').delete().eq('venue_id', venueId);
    await db.from('leads').delete().eq('venue_id', venueId);
    await db.from('venues').delete().eq('id', venueId);
  }, 180_000);

  it('the Lead Inbox shows every lead it lists with its tags, its notes and its duplicate warning', async () => {
    const res = await owner.fetch('/api/leads');
    expect(res.status, await res.clone().text().then((t) => t.slice(0, 300))).toBe(200);
    const { leads: listed } = (await res.json()) as { leads: Array<{ id: string; tags: unknown[]; note_count: number; duplicate_matches: unknown[] }> };
    expect(listed.length).toBeGreaterThan(900);
    expect(listed.filter((l) => l.tags.length !== 1).length, 'leads shown without their tag').toBe(0);
    const newest = listed.find((l) => l.id === leads[0].id)!;
    expect(newest).toBeTruthy();
    expect(newest.note_count).toBe(2);
    expect(newest.duplicate_matches).toHaveLength(1);
  }, 120_000);

  const audience = async (segment: Record<string, unknown>) => {
    const res = await owner.fetch('/api/marketing/segments/preview', { method: 'POST', json: { segment } });
    expect(res.status, await res.clone().text().then((t) => t.slice(0, 300))).toBe(200);
    return ((await res.json()) as { count: number }).count;
  };

  it('a campaign to all leads reaches all of them, not the first thousand', async () => {
    expect(await audience({ type: 'all_leads' })).toBe(MANY);
  }, 120_000);

  it('a campaign to a tag reaches everyone who has it', async () => {
    expect(await audience({ type: 'tags_any', tag_ids: [tagId] })).toBe(MANY);
  }, 120_000);

  it('an unsubscribed lead is left out of both', async () => {
    const off = await db.from('marketing_email_suppressions').insert({ lead_id: leads[MANY - 1].id, venue_id: venueId, reason: 'unsubscribed' });
    expect(off.error?.message ?? null).toBeNull();
    expect(await audience({ type: 'all_leads' })).toBe(MANY - 1);
    expect(await audience({ type: 'tags_any', tag_ids: [tagId] })).toBe(MANY - 1);
    await db.from('marketing_email_suppressions').delete().eq('venue_id', venueId);
  }, 120_000);
});
