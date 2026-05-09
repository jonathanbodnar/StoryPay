/**
 * Minimal RFC 6238 TOTP implementation — no third-party deps.
 *
 * Compatible with Google Authenticator, Authy, 1Password, Bitwarden, etc.
 * Uses HMAC-SHA1 with a 30-second window and 6-digit codes (the universal
 * default; some apps offer SHA-256 / 8 digits but every authenticator app
 * supports SHA-1/6, and our otpauth:// URI explicitly pins these defaults).
 *
 * We also expose backup-code helpers for the recovery flow.
 */

import crypto from 'crypto';

// ───────── Base32 (RFC 4648, no padding) ──────────────────────────────────
//
// Authenticator apps consume secrets as base32. We never expose the raw
// bytes — only the encoded string — so the QR / manual entry both work.

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}

function base32Decode(str: string): Buffer {
  const clean = str.replace(/=+$/, '').toUpperCase().replace(/\s+/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ───────── TOTP core ──────────────────────────────────────────────────────

/** Generate a new 20-byte secret and return the base32-encoded string. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/**
 * Compute the 6-digit TOTP for a given timestamp.
 *
 * `timestamp` is in seconds (defaults to now). The 30-second step is the
 * RFC 6238 default and what every authenticator app uses out of the box.
 */
export function computeTotp(secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const step = 30;
  const counter = Math.floor(timestamp / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));

  const key = base32Decode(secret);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();

  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binCode % 1_000_000).padStart(6, '0');
}

/**
 * Verify a user-submitted 6-digit code.
 *
 * Allows ±1 step of clock drift (so a code is valid for up to 90 seconds
 * total — generous but standard practice; phones routinely drift a few
 * seconds and re-typing a code is the most common 2FA support ticket).
 */
export function verifyTotp(secret: string, code: string): boolean {
  const trimmed = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(trimmed)) return false;
  const now = Math.floor(Date.now() / 1000);
  const step = 30;
  for (const drift of [-1, 0, 1]) {
    const candidate = computeTotp(secret, now + drift * step);
    // Constant-time compare to keep the verify endpoint timing-safe
    if (
      candidate.length === trimmed.length &&
      crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(trimmed))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Build the otpauth:// URI used to render the setup QR code.
 *
 * Format: otpauth://totp/<issuer>:<accountName>?secret=...&issuer=<issuer>
 * We explicitly pin algorithm/digits/period for clients that don't use
 * the spec defaults.
 */
export function buildOtpAuthUri(opts: {
  secret:      string;
  accountName: string;
  issuer?:     string;
}): string {
  const issuer = opts.issuer ?? 'StoryVenue';
  const label  = `${encodeURIComponent(issuer)}:${encodeURIComponent(opts.accountName)}`;
  const params = new URLSearchParams({
    secret:    opts.secret,
    issuer,
    algorithm: 'SHA1',
    digits:    '6',
    period:    '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ───────── Backup codes ───────────────────────────────────────────────────

/**
 * Generate `n` human-friendly recovery codes (e.g. "A3F2-9XKD").
 * Returns the plaintext codes; callers should bcrypt-hash before storing.
 */
export function generateBackupCodes(n = 10): string[] {
  const out: string[] = [];
  // Avoid look-alike chars (0/O, 1/I) — a printed code that gets misread is
  // a support ticket waiting to happen.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < n; i++) {
    let raw = '';
    const bytes = crypto.randomBytes(8);
    for (let j = 0; j < 8; j++) raw += alphabet[bytes[j] % alphabet.length];
    out.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return out;
}

/** Normalize for comparison (strip dashes/spaces, uppercase). */
export function normalizeBackupCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}
