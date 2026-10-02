/**
 * The test copy of StoryVenue (APP_ENV=staging): the same code as the live
 * site, on its own database with fake data. These switches keep it from ever
 * reaching a real person or a live system:
 *  - email goes only to STAGING_EMAIL_ALLOWLIST (addresses or @domains) with
 *    "[TEST]" on the subject; anything else is logged as not sent
 *  - app notifications, the owner's GHL pipeline sync, the directory refresh
 *    and the built-in timers (in-app-scheduler.ts) are off
 *  - it refuses to start with live settings (stagingConfigProblems)
 *  - a catch-all blocks web requests to GHL, LunarPay, push services, Slack
 *    and the live site (installStagingFetchGuard)
 * On the live site none of this does anything.
 */

export function isStaging(): boolean {
  return process.env.APP_ENV === 'staging';
}

/** The live Supabase project (not a secret: browsers load its URL). */
const LIVE_SUPABASE_REF = 'brnxhsaakmhgwcthcapd';

/**
 * Live settings the test copy must never have. Returns what's wrong, by
 * setting name only (never a value), so startup can refuse with a clear error.
 */
export function stagingConfigProblems(env: Record<string, string | undefined> = process.env): string[] {
  const problems: string[] = [];
  for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_DB_URL', 'DATABASE_URL']) {
    if (env[name]?.includes(LIVE_SUPABASE_REF)) problems.push(`${name} points at the live database`);
  }
  for (const name of ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY']) {
    if (/^(sk|pk|rk)_live_/.test(env[name]?.trim() ?? '')) problems.push(`${name} is a live Stripe key`);
  }
  for (const name of [
    'LP_AGENCY_KEY', 'STORYPAY_HQ_LUNARPAY_SK', 'STORYPAY_HQ_LUNARPAY_PK', // LunarPay payments
    'GHL_AGENCY_API_KEY', 'OWNER_GHL_PIT_TOKEN',                           // real texts / your pipeline
    'NEXT_PUBLIC_META_PIXEL_ID', 'SLACK_SUPPORT_WEBHOOK_URL',              // ad tracking / support Slack
  ]) {
    if (env[name]?.trim()) problems.push(`${name} is set`);
  }
  return problems;
}

/** "Name <a@b.com>" → "a@b.com", lowercased. */
function bareEmail(addr: string): string {
  const m = /<([^>]+)>/.exec(addr);
  return (m ? m[1] : addr).trim().toLowerCase();
}

/**
 * Which recipients the test copy may email: those on STAGING_EMAIL_ALLOWLIST
 * (comma-separated addresses, or "@domain" for a whole domain). The live site
 * may email everyone.
 */
export function stagingEmailFilter(recipients: string[]): { allowed: string[]; blocked: string[] } {
  if (!isStaging()) return { allowed: recipients, blocked: [] };
  const rules = (process.env.STAGING_EMAIL_ALLOWLIST ?? '')
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
  const allowed: string[] = [];
  const blocked: string[] = [];
  for (const r of recipients) {
    const email = bareEmail(r);
    const ok = rules.some((rule) => (rule.startsWith('@') ? email.endsWith(rule) : email === rule));
    (ok ? allowed : blocked).push(r);
  }
  return { allowed, blocked };
}

// Hosts the test copy must never call: real texting/CRM, payments, app
// notifications, the support Slack, and the live site and directory.
// Texting/CRM (GHL) calls are answered by a stand-in instead (lib/staging-ghl).
const GHL_HOSTS = ['leadconnectorhq.com', 'gohighlevel.com', 'msgsndr.com'];
const BLOCKED_HOSTS = [
  ...GHL_HOSTS,
  'lunarpay.com',
  'fcm.googleapis.com', 'push.apple.com', 'push.services.mozilla.com', 'notify.windows.com',
  'hooks.slack.com',
  'storyvenue.com', 'storypay.io',
];

export function stagingBlocksHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return BLOCKED_HOSTS.some((b) => h === b || h.endsWith(`.${b}`));
}

/**
 * Catch-all for the test copy: fetch() to a blocked host fails as if the
 * network were down, so code added later is covered too. Installed once at
 * startup (instrumentation.ts).
 */
export function installStagingFetchGuard(): void {
  if (!isStaging()) return;
  const g = globalThis as typeof globalThis & { __stagingFetchGuard?: boolean };
  if (g.__stagingFetchGuard) return;
  g.__stagingFetchGuard = true;
  const realFetch = globalThis.fetch;
  globalThis.fetch = function stagingFetch(input: RequestInfo | URL, init?: RequestInit) {
    let host = '';
    try {
      host = new URL(input instanceof Request ? input.url : String(input)).hostname;
    } catch {
      // Not an absolute URL: nothing to check.
    }
    if (host && GHL_HOSTS.some((b) => host === b || host.endsWith(`.${b}`))) {
      // Texting/CRM: the stand-in records texts and plays couples' replies.
      return import('@/lib/staging-ghl').then(({ fakeGhlFetch }) => fakeGhlFetch(input, init));
    }
    if (host && stagingBlocksHost(host)) {
      console.warn(`[staging] blocked a request to ${host}`);
      return Promise.reject(new Error(`Blocked in the test copy: ${host}`));
    }
    return realFetch(input, init);
  } as typeof fetch;
}
