import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, ensureFlowVenue, env, FLOW_VENUE, runId } from './helpers';

// A new member each run: the gate remembers account status for a minute, so
// reusing one removed by the last run would look removed for a while.
const MEMBER = { id: randomUUID(), email: `flow-member.${runId}@example.com` };

describe('team members', () => {
  const member = new Browser();
  const owner = new Browser();

  beforeAll(async () => {
    await ensureFlowVenue();
    await db.from('venue_team_members').delete().eq('venue_id', FLOW_VENUE.id).like('email', 'flow-member%@example.com');
    const { error } = await db.from('venue_team_members').upsert({
      id: MEMBER.id, venue_id: FLOW_VENUE.id, email: MEMBER.email, first_name: 'Flow', last_name: 'Member',
      role: 'member', status: 'active', hide_revenue: true, password_hash: await bcrypt.hash(env.password, 10),
      session_invalidated_before: null,
    }, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    await member.signIn(MEMBER.email);
    await owner.signIn(FLOW_VENUE.email);
  });

  it('a member without revenue access is refused revenue, but can work leads', async () => {
    expect((await member.fetch('/api/transactions')).status).toBe(403);
    expect((await member.fetch('/api/reports')).status).toBe(403);
    expect((await member.fetch('/api/leads')).status).toBe(200);
  });

  it('the owner sees revenue', async () => {
    expect((await owner.fetch('/api/reports')).status).toBe(200);
    // No payment account on the test venue: "not set up yet", never "hidden".
    const tx = await owner.fetch('/api/transactions');
    expect(tx.status).not.toBe(403);
    expect(await tx.text()).not.toMatch(/Revenue is hidden/);
  });

  it('a removed member loses their open session within about a minute', async () => {
    await db.from('venue_team_members').update({ status: 'removed' }).eq('id', MEMBER.id);
    const until = Date.now() + 80_000;
    let status = 0;
    while (Date.now() < until) {
      status = (await member.fetch('/api/leads')).status;
      if (status === 401) break;
      await new Promise((r) => setTimeout(r, 5_000));
    }
    expect(status).toBe(401);
    expect((await owner.fetch('/api/leads')).status).toBe(200);
  }, 100_000);
});
