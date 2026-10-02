import bcrypt from 'bcryptjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, env } from './helpers';

// The admin side, as a StoryVenue team member (email + password). The master
// admin's sign-in emails a code to the owner's real inbox even on the test
// copy, so it isn't run on every check.
describe('the StoryVenue team', () => {
  const email = 'flow-support@example.com';
  const team = new Browser();

  async function setMember(active: boolean) {
    const row = { email, name: 'Flow Support', first_name: 'Flow', last_name: 'Support', role: 'support_admin', password_hash: await bcrypt.hash(env.password, 10), active };
    const { data: existing } = await db.from('support_team_members').select('id').ilike('email', email).maybeSingle();
    const { error } = existing
      ? await db.from('support_team_members').update(row).eq('id', existing.id)
      : await db.from('support_team_members').insert(row);
    if (error) throw new Error(`team member: ${error.message}`);
  }
  const signIn = (b: Browser, password: string) => b.fetch('/api/admin/login', { method: 'POST', json: { email, password } });

  beforeAll(async () => {
    await setMember(true);
  });

  it('a team member signs in and the admin knows who they are', async () => {
    const res = await signIn(team, env.password);
    expect(res.status, await res.clone().text()).toBe(200);
    const me = await team.fetch('/api/admin/me');
    expect(me.status).toBe(200);
    expect(JSON.stringify(await me.json())).toContain(email);
  });

  it('they can work the support inbox', async () => {
    expect((await team.fetch('/api/admin/support/bride-inbox')).status).toBe(200);
    expect((await team.fetch('/api/admin/support/inbox-count')).status).toBe(200);
  });

  it('a wrong password, or a deactivated member, is refused', async () => {
    expect((await signIn(new Browser(), `${env.password}-wrong`)).status).toBe(401);
    await setMember(false);
    try {
      expect((await signIn(new Browser(), env.password)).status).toBe(401);
    } finally {
      await setMember(true);
    }
  });
});
