import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, coupleSession, db, env, outbox, runId, SWEEP_COUPLE, waitForEmail } from './helpers';

// A new venue signs up: account and trial, welcome email, the setup wizard
// through going live and its test inquiry, then signing back in. Signing up
// with an email that's taken is refused, and a couple's planner email is never
// touched (it used to be deleted as a "leftover" login, planner and all).
describe('a new venue signs up and sets up', () => {
  const email = `signup.${runId}@example.com`;
  const password = `Signup-${runId}-Barn-2027!`;
  const venueName = `Signup Barn ${runId}`;
  const venue = new Browser();
  let venueId = '';
  let since = '';

  const signup = (b: Browser, overrides: Record<string, unknown> = {}) => b.fetch('/api/auth/signup', {
    method: 'POST',
    json: { venue_name: venueName, first_name: 'Sam', last_name: 'Signup', email, phone: '(212) 555-0161', password, ...overrides },
  });

  beforeAll(() => { since = new Date().toISOString(); });

  it('signs up, signed in at once, on a trial, with a welcome email', async () => {
    const res = await signup(venue);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { redirect: string }).redirect).toContain('/signup/success');
    const { data } = await db.from('venues').select('id, directory_subscription_status, directory_trial_ends_at').ilike('email', email).single();
    venueId = data!.id;
    expect(data!.directory_subscription_status).toBe('trialing');
    const days = (Date.parse(data!.directory_trial_ends_at) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6);
    const me = await venue.fetch('/api/venues/me');
    expect(me.status).toBe(200);
    await waitForEmail({ to: email, since }, (e) => e.subject.startsWith('Welcome to StoryVenue'));
    // The StoryVenue team hears about it (kept in the outbox; the test copy is quiet).
    await waitForEmail({ to: 'jason@storyvenue.com', since }, (e) => e.subject === `New signup: ${venueName}`);
  });

  it('the setup wizard publishes the listing and the guide', async () => {
    const state = await venue.fetch('/api/onboarding/state');
    expect(state.status).toBe(200);
    expect(((await state.json()) as { is_published: boolean }).is_published).toBe(false);
    expect((await venue.fetch('/api/onboarding/state', { method: 'POST', json: { action: 'step', step: 3 } })).status).toBe(200);
    const pub = await venue.fetch('/api/onboarding/state', { method: 'POST', json: { action: 'publish' } });
    expect(pub.status, await pub.clone().text()).toBe(200);
    expect(((await pub.json()) as { is_published: boolean }).is_published).toBe(true);
    const { data } = await db.from('venues').select('is_published').eq('id', venueId).single();
    expect(data!.is_published).toBe(true);
  });

  it('the test inquiry lands a lead in the new venue’s inbox', async () => {
    const res = await venue.fetch('/api/onboarding/test-inquiry', { method: 'POST', json: {} });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    const { data: leads } = await db.from('leads').select('id').eq('venue_id', venueId);
    expect(leads!.length).toBeGreaterThan(0);
  });

  it('finishing setup opens the dashboard, and the password signs back in', async () => {
    expect((await venue.fetch('/api/onboarding/state', { method: 'POST', json: { action: 'finish' } })).status).toBe(200);
    const { data } = await db.from('venues').select('onboarding_completed_at').eq('id', venueId).single();
    expect(data!.onboarding_completed_at).toBeTruthy();
    expect((await venue.fetch('/dashboard')).status).toBe(200);
    const again = new Browser();
    await again.signIn(email, password);
    expect((await again.fetch('/api/venues/me')).status).toBe(200);
  });

  it('an email that already has a venue is refused', async () => {
    const res = await signup(new Browser());
    expect(res.status).toBe(409);
  });

  it('a couple’s planner email is refused, and the couple’s account is untouched', async () => {
    await coupleSession(); // make sure the planner account exists
    const res = await signup(new Browser(), { email: SWEEP_COUPLE.email, venue_name: `Not A Couple ${runId}` });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/Wedding Planner/);
    const session = await coupleSession(); // still signs in
    expect(session.access_token).toBeTruthy();
    const me = await fetch(`${env.base}/api/couple/me`, { headers: { 'x-staging-key': env.stagingKey, authorization: `Bearer ${session.access_token}` } });
    expect(me.status).toBe(200);
  });

  it('asks for the details it needs and a strong password', async () => {
    expect((await signup(new Browser(), { email: `missing.${runId}@example.com`, venue_name: '' })).status).toBe(400);
    expect((await signup(new Browser(), { email: `weak.${runId}@example.com`, password: 'password' })).status).toBe(400);
    expect((await outbox({ to: `weak.${runId}@example.com`, since })).length).toBe(0);
  });
});
