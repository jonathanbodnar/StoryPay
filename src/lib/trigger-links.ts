import { randomBytes } from 'crypto';

/** URL-safe token for /t/[code]; 10 chars, unguessable enough for tracking links. */
export function generateTriggerShortCode(): string {
  return randomBytes(8).toString('base64url').replace(/=/g, '').slice(0, 10);
}
