/**
 * GET/POST /staging-access — the test copy's password page (see
 * src/lib/staging-access.ts). Not found on the live site.
 */

import { NextRequest } from 'next/server';
import { isStaging } from '@/lib/staging';
import { STAGING_ACCESS_COOKIE, stagingAccessToken, sameSecret, safeNextPath } from '@/lib/staging-access';

export const dynamic = 'force-dynamic';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function page(next: string, message: string | null, status = 200): Response {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>StoryVenue test copy</title></head>
<body style="margin:0;background:#f2f2f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1b1b1b;">
  <form method="post" style="max-width:360px;margin:12vh auto 0;padding:32px 28px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;">
    <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#b45309;">Test copy</p>
    <h1 style="margin:0 0 8px;font-size:20px;">StoryVenue staging</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#4b5563;">Fake data only. Emails go to approved addresses, and texts and real payments are off.</p>
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;" for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus
      style="box-sizing:border-box;width:100%;padding:10px 12px;font-size:15px;border:1px solid #d1d5db;border-radius:8px;">
    ${message ? `<p style="margin:10px 0 0;font-size:13px;color:#b91c1c;">${escapeHtml(message)}</p>` : ''}
    <button type="submit" style="margin-top:18px;width:100%;padding:11px;font-size:15px;font-weight:600;color:#fff;background:#1b1b1b;border:0;border-radius:8px;cursor:pointer;">Enter</button>
  </form>
</body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function GET(request: NextRequest) {
  if (!isStaging()) return new Response('Not found', { status: 404 });
  const configured = !!process.env.STAGING_PASSWORD?.trim();
  return page(safeNextPath(request.nextUrl.searchParams.get('next')), configured ? null : 'No password is set up yet (STAGING_PASSWORD).');
}

export async function POST(request: NextRequest) {
  if (!isStaging()) return new Response('Not found', { status: 404 });
  const form = await request.formData();
  const next = safeNextPath(String(form.get('next') ?? '/'));
  const password = process.env.STAGING_PASSWORD?.trim();
  const given = String(form.get('password') ?? '');
  if (!password || !sameSecret(given, password)) {
    await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
    return page(next, 'That password is not right.', 401);
  }
  // A relative Location: behind Railway the request's own origin is the
  // container's (https://localhost:8080), not the public address.
  const res = new Response(null, { status: 303, headers: { Location: next, 'cache-control': 'no-store' } });
  res.headers.append('Set-Cookie', `${STAGING_ACCESS_COOKIE}=${await stagingAccessToken(password)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
  return res;
}
