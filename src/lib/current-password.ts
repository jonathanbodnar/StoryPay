import bcrypt from 'bcryptjs';
import { formatRetryAfter, rateLimit } from '@/lib/rate-limit';

/**
 * A sign-in email or password is changed by the person who knows the current
 * password. Being signed in isn't enough: that is just as true of whoever sits
 * down at a shared computer or an unlocked laptop. Until Oct 6 2026 My Profile
 * changed both for anyone signed in.
 *
 * An account with no password yet (it came in from an emailed link and never
 * set one) has nothing to ask for, and may set its first.
 */
export type CurrentPasswordCheck =
  | { ok: true }
  | { ok: false; status: 400 | 429; error: string; retryAfterSeconds?: number };

/** As many guesses a minute as the sign-in page allows for one account. */
const GUESSES_A_MINUTE = 5;

/**
 * @param account who is being changed, e.g. "venue:<id>" or "member:<id>": guesses are counted per account
 * @param storedHash the account's password as stored; empty when it has none
 * @param given what the person typed as their current password
 */
export async function checkCurrentPassword(
  account: string,
  storedHash: string | null | undefined,
  given: unknown,
): Promise<CurrentPasswordCheck> {
  if (!storedHash) return { ok: true };
  const typed = typeof given === 'string' ? given.trim() : '';
  if (!typed) return { ok: false, status: 400, error: 'Enter your current password to make this change.' };

  const limit = rateLimit(`current-password:${account}`, GUESSES_A_MINUTE, 60_000);
  if (!limit.allowed) {
    return {
      ok: false,
      status: 429,
      error: `Too many attempts. Try again in ${formatRetryAfter(limit.retryAfterMs)}.`,
      retryAfterSeconds: Math.ceil(limit.retryAfterMs / 1000),
    };
  }
  if (!(await bcrypt.compare(typed, storedHash))) return { ok: false, status: 400, error: 'Incorrect password.' };
  return { ok: true };
}
