import { NextResponse } from 'next/server';

/**
 * Admin login — email + password.
 *
 * Credentials are read from env vars:
 *   ADMIN_EMAIL      — admin email address
 *   ADMIN_PASSWORD   — admin password (plaintext in env, never stored in DB)
 *   ADMIN_SECRET     — fallback single-secret for backward compat
 *
 * On success, sets an httpOnly admin_token cookie containing ADMIN_SECRET.
 */
export async function POST(request: Request) {
  const body = await request.json() as { email?: string; password?: string; secret?: string };

  const adminEmail    = process.env.ADMIN_EMAIL ?? '';
  const adminPassword = process.env.ADMIN_PASSWORD ?? '';
  const adminSecret   = process.env.ADMIN_SECRET ?? '';

  let valid = false;

  if (body.email !== undefined || body.password !== undefined) {
    if (adminEmail && adminPassword) {
      // Full email + password auth (both env vars set)
      const emailMatch    = body.email?.trim().toLowerCase() === adminEmail.toLowerCase();
      const passwordMatch = body.password === adminPassword;
      valid = emailMatch && passwordMatch;
    } else if (adminSecret) {
      // Legacy fallback: ADMIN_SECRET used as the password
      // (ADMIN_EMAIL / ADMIN_PASSWORD not configured yet)
      valid = body.password === adminSecret;
    }
  } else if (body.secret !== undefined) {
    // Old single-secret flow (backward compat)
    valid = !!(adminSecret && body.secret === adminSecret);
  }

  if (!valid) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set('admin_token', adminSecret, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set('admin_token', '', {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0,
  });
  return response;
}
