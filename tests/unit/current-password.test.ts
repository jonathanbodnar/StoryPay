import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { checkCurrentPassword } from '@/lib/current-password';

// Who may change a sign-in email or password: the person who knows the current
// one. Until Oct 6 2026 My Profile changed both for anyone signed in, so a
// shared computer or an unlocked laptop was enough to take an account.
describe('asking for the current password', () => {
  const hash = bcrypt.hashSync('Garden-Gate-2027!', 4);

  it('nothing typed is refused, and so is the wrong password', async () => {
    expect(await checkCurrentPassword('venue:a', hash, undefined)).toMatchObject({ ok: false, status: 400 });
    expect(await checkCurrentPassword('venue:a', hash, '   ')).toMatchObject({ ok: false, status: 400 });
    expect(await checkCurrentPassword('venue:a', hash, 'garden-gate-2027!')).toEqual({ ok: false, status: 400, error: 'Incorrect password.' });
  });

  it('the right one is let through', async () => {
    expect(await checkCurrentPassword('venue:b', hash, 'Garden-Gate-2027!')).toEqual({ ok: true });
  });

  it('an account that never set a password has none to ask for', async () => {
    expect(await checkCurrentPassword('member:c', null, undefined)).toEqual({ ok: true });
    expect(await checkCurrentPassword('member:c', '', 'anything')).toEqual({ ok: true });
  });

  it('guessing is slowed to a few tries a minute, per account', async () => {
    for (let i = 0; i < 5; i++) {
      expect(await checkCurrentPassword('venue:d', hash, `guess-${i}`)).toMatchObject({ ok: false, status: 400 });
    }
    const sixth = await checkCurrentPassword('venue:d', hash, 'Garden-Gate-2027!');
    expect(sixth).toMatchObject({ ok: false, status: 429 });
    expect((sixth as { retryAfterSeconds?: number }).retryAfterSeconds).toBeGreaterThan(0);
    // Someone else's account isn't held up by it, and leaving the box empty isn't a guess.
    expect(await checkCurrentPassword('venue:e', hash, 'Garden-Gate-2027!')).toEqual({ ok: true });
    expect(await checkCurrentPassword('venue:d', hash, '')).toMatchObject({ ok: false, status: 400 });
  });
});
