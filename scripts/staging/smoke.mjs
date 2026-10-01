#!/usr/bin/env node
/**
 * Smoke test for the test copy: the password page holds, the demo owner can
 * sign in, the dashboard opens without a billing wall, and the leads load.
 *
 *   railway run --service "StoryVenue Backend" --environment Dev -- node scripts/staging/smoke.mjs
 *
 * Reads the address and passwords from the Dev environment; prints none of them.
 */

const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
const key = process.env.STAGING_PASSWORD || '';
const email = process.env.ADMIN_EMAIL || '';
if (process.env.APP_ENV !== 'staging' || !base || !key || !email) {
  console.error('Run this with railway run --environment Dev.');
  process.exit(1);
}

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};
const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
async function call(path, init = {}, withKey = true) {
  const res = await fetch(base + path, {
    redirect: 'manual',
    ...init,
    headers: { ...(withKey ? { 'x-staging-key': key } : {}), cookie: cookieHeader(), ...(init.headers || {}) },
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return res;
}

// 1. Locked without the password.
const locked = await call('/dashboard', {}, false);
check(locked.status === 307 && (locked.headers.get('location') || '').includes('/staging-access'), 'pages are locked without the password', String(locked.status));
check((await call('/api/leads', {}, false)).status === 401, 'APIs are locked without the password');
const gate = await call('/staging-access', { method: 'POST', body: new URLSearchParams({ password: key, next: '/dashboard' }) }, false);
const goesTo = gate.headers.get('location') || '';
check(gate.status === 303 && (goesTo.startsWith('/') || goesTo.startsWith(base)), 'the password page sends you back to this site', goesTo);

// 2. The demo owner signs in.
const signIn = await call('/api/auth/sign-in', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: key }),
});
check(signIn.ok && jar.has('venue_id'), 'demo owner signs in', String(signIn.status));

// 3. The dashboard opens, without a billing wall.
const dash = await call('/dashboard');
const html = await dash.text();
check(dash.status === 200, 'dashboard opens', String(dash.status));
check(html.includes('Maple Hollow Barn'), 'it is the demo venue');
check(!/trial has ended|payment failed|past due/i.test(html), 'no billing wall');

// 4. Leads load.
const leads = await call('/api/leads');
const body = await leads.json().catch(() => null);
const list = Array.isArray(body) ? body : body?.leads ?? body?.data ?? [];
check(leads.ok && list.length >= 8, 'leads load', `${leads.status}, ${list.length} leads`);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll smoke checks passed');
process.exit(failures ? 1 : 0);
