import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, env, FLOW_VENUE, runId } from './helpers';

// My Profile: what a person signs in with. Until Oct 6 2026 a signed-in browser
// could change the sign-in email and the password with nothing else asked: a
// shared computer at a venue, or an unlocked laptop, was enough to take the
// account. Both changes now take the current password (lib/current-password),
// and the Personal Information form no longer changes the sign-in email at all.

const venueId = randomUUID();
const email = `profile-owner.${runId}@example.com`;
const newEmail = `profile-owner-new.${runId}@example.com`;
const newPassword = `Profile-${runId}-Maple-2027!`;
const person = { first_name: 'Pia', last_name: 'Profile', phone: '(212) 555-0142' };

const venueRow = async () =>
  (await db.from('venues').select('email, password_hash, owner_first_name').eq('id', venueId).single()).data as
    { email: string; password_hash: string; owner_first_name: string | null };

describe('a venue owner changes what they sign in with', () => {
  let owner: Browser;

  beforeAll(async () => {
    const { error } = await db.from('venues').insert({
      id: venueId, name: `Profile Venue ${runId}`, slug: `profile-venue-${runId}`, email, notification_email: email,
      password_hash: await bcrypt.hash(env.password, 10), setup_completed: true, onboarding_status: 'registered',
      onboarding_completed_at: new Date().toISOString(), email_verified_at: new Date().toISOString(), timezone: 'America/New_York',
    });
    if (error) throw new Error(error.message);
    owner = new Browser();
    await owner.signIn(email);
  });

  it('the profile says there is a password to ask for, and never sends it', async () => {
    const res = await owner.fetch('/api/profile');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ type: 'owner', email, has_password: true });
    expect(text).not.toMatch(/password_hash|\$2[aby]\$/);
  });

  it('being signed in isn’t enough to change the password', async () => {
    const change = { action: 'password', new_password: newPassword, confirm_password: newPassword };
    const without = await owner.fetch('/api/profile/credentials', { method: 'PATCH', json: change });
    expect(without.status, await without.clone().text()).toBe(400);
    expect((await without.json()).error).toMatch(/current password/i);

    const wrong = await owner.fetch('/api/profile/credentials', { method: 'PATCH', json: { ...change, current_password: 'not-the-password' } });
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error).toBe('Incorrect password.');

    expect(await bcrypt.compare(env.password, (await venueRow()).password_hash), 'the password is the one it was').toBe(true);
  });

  it('with the current password it changes, and the new one signs in', async () => {
    const res = await owner.fetch('/api/profile/credentials', {
      method: 'PATCH', json: { action: 'password', current_password: env.password, new_password: newPassword, confirm_password: newPassword },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await bcrypt.compare(env.password, (await venueRow()).password_hash)).toBe(false);
    await new Browser().signIn(email, newPassword);
  });

  it('the Personal Information form saves a name and phone, and leaves the sign-in email alone', async () => {
    const moved = await owner.fetch('/api/profile', { method: 'PATCH', json: { ...person, email: newEmail } });
    expect(moved.status, await moved.clone().text()).toBe(400);
    expect((await moved.json()).error).toMatch(/Change Email/);
    expect((await venueRow()).email).toBe(email);

    const saved = await owner.fetch('/api/profile', { method: 'PATCH', json: { ...person, email } });
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(await venueRow()).toMatchObject({ email, owner_first_name: 'Pia' });
  });

  it('Change Email takes the current password; then the new address signs in', async () => {
    const without = await owner.fetch('/api/profile/credentials', { method: 'PATCH', json: { action: 'email', new_email: newEmail } });
    expect(without.status).toBe(400);
    expect((await without.json()).error).toMatch(/current password/i);
    expect((await venueRow()).email).toBe(email);

    // Whether another account has an address is only said to someone who knows the password.
    const taken = { action: 'email', new_email: FLOW_VENUE.email };
    const probe = await owner.fetch('/api/profile/credentials', { method: 'PATCH', json: taken });
    expect(probe.status).toBe(400);
    expect((await probe.json()).error).not.toMatch(/in use/i);
    const told = await owner.fetch('/api/profile/credentials', { method: 'PATCH', json: { ...taken, current_password: newPassword } });
    expect(told.status).toBe(409);

    const res = await owner.fetch('/api/profile/credentials', { method: 'PATCH', json: { action: 'email', new_email: newEmail, current_password: newPassword } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await venueRow()).email).toBe(newEmail);
    await new Browser().signIn(newEmail, newPassword);
  });
});

describe('a team member changes what they sign in with', () => {
  const memberEmail = `profile-member.${runId}@example.com`;
  const movedEmail = `profile-member-new.${runId}@example.com`;
  const memberPassword = `Member-${runId}-Cedar-2027!`;
  const nextPassword = `Member-${runId}-Birch-2027!`;
  const linkOnlyEmail = `profile-linkonly.${runId}@example.com`;
  const linkOnlyToken = randomUUID();
  let member: Browser;
  let memberId = '';
  let linkOnlyId = '';

  const memberRow = async (id: string) =>
    (await db.from('venue_team_members').select('email, first_name, password_hash').eq('id', id).single()).data as
      { email: string; first_name: string; password_hash: string | null };

  beforeAll(async () => {
    const base = { venue_id: venueId, last_name: 'Member', role: 'member', status: 'active', invited_at: new Date().toISOString() };
    const made = await db.from('venue_team_members').insert([
      { ...base, first_name: 'Mel', name: 'Mel Member', email: memberEmail, password_hash: await bcrypt.hash(memberPassword, 10), invite_token: randomUUID() },
      // Came in from the emailed link and never set a password: the link's token is all they have.
      { ...base, first_name: 'Lin', name: 'Lin Member', email: linkOnlyEmail, invite_token: linkOnlyToken },
    ]).select('id, email');
    if (made.error) throw new Error(made.error.message);
    memberId = made.data!.find((m) => m.email === memberEmail)!.id;
    linkOnlyId = made.data!.find((m) => m.email === linkOnlyEmail)!.id;
    member = new Browser();
    await member.signIn(memberEmail, memberPassword);
  });

  it('their password: not without the current one', async () => {
    expect(await (await member.fetch('/api/profile')).json()).toMatchObject({ type: 'member', has_password: true });
    const change = { action: 'password', new_password: nextPassword, confirm_password: nextPassword };
    expect((await member.fetch('/api/profile/credentials', { method: 'PATCH', json: change })).status).toBe(400);
    expect((await member.fetch('/api/profile/credentials', { method: 'PATCH', json: { ...change, current_password: 'not-it' } })).status).toBe(400);
    expect(await bcrypt.compare(memberPassword, (await memberRow(memberId)).password_hash ?? '')).toBe(true);

    const res = await member.fetch('/api/profile/credentials', { method: 'PATCH', json: { ...change, current_password: memberPassword } });
    expect(res.status, await res.clone().text()).toBe(200);
    await new Browser().signIn(memberEmail, nextPassword);
  });

  it('their name saves as before; a new sign-in email takes the current password', async () => {
    const renamed = await member.fetch('/api/profile', { method: 'PATCH', json: { first_name: 'Melanie', last_name: 'Member', email: memberEmail } });
    expect(renamed.status, await renamed.clone().text()).toBe(200);

    const without = await member.fetch('/api/profile', { method: 'PATCH', json: { first_name: 'Melanie', last_name: 'Member', email: movedEmail } });
    expect(without.status).toBe(400);
    expect(await memberRow(memberId)).toMatchObject({ email: memberEmail, first_name: 'Melanie' });

    const withIt = await member.fetch('/api/profile', { method: 'PATCH', json: { first_name: 'Melanie', last_name: 'Member', email: movedEmail, current_password: nextPassword } });
    expect(withIt.status, await withIt.clone().text()).toBe(200);
    expect((await memberRow(memberId)).email).toBe(movedEmail);
    expect(JSON.stringify(await withIt.json())).not.toMatch(/password_hash/);
  });

  it('a member who never set a password sets their first one', async () => {
    const linkOnly = new Browser();
    await linkOnly.signIn(linkOnlyEmail, linkOnlyToken);
    expect(await (await linkOnly.fetch('/api/profile')).json()).toMatchObject({ type: 'member', has_password: false });
    const first = `First-${runId}-Aspen-2027!`;
    const res = await linkOnly.fetch('/api/profile/credentials', { method: 'PATCH', json: { action: 'password', new_password: first, confirm_password: first } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await bcrypt.compare(first, (await memberRow(linkOnlyId)).password_hash ?? '')).toBe(true);
    // From here on it is asked for like anyone's.
    const again = await linkOnly.fetch('/api/profile/credentials', { method: 'PATCH', json: { action: 'password', new_password: `${first}x`, confirm_password: `${first}x` } });
    expect(again.status).toBe(400);
  });
});
