/**
 * What a StoryVenue team member who isn't a full admin may change through the
 * admin API. They can read across it as before, but a change (POST, PUT, PATCH,
 * DELETE) only goes through behind a tab they've been given (Team settings,
 * src/lib/admin-tabs-registry.ts). A change in a section not listed here is
 * for full admins only. The master admin and full team admins can do anything.
 *
 * The proxy (src/proxy.ts) passes "<METHOD> <path>" for every /api request in
 * ADMIN_REQUEST_HEADER, overwriting anything a client sends in it.
 */
export const ADMIN_REQUEST_HEADER = 'x-storyvenue-admin-request';

/** Admin API section (the path after /api/admin/) → the tabs whose screens make changes through it. */
export const ADMIN_WRITE_TABS: ReadonlyArray<readonly [prefix: string, tabs: readonly string[]]> = [
  // Leaving "View as venue" always works.
  ['impersonate/exit', ['*']],
  // "View as venue" is offered from these screens.
  ['impersonate', ['venues', 'projects', 'support', 'contacts', 'couples', 'subscriptions']],
  ['venues', ['venues', 'projects']],
  ['subscriptions', ['subscriptions']],
  ['billing', ['subscriptions']],
  ['directory-plans', ['directory-plans']],
  ['directory-features', ['directory-plans']],
  ['addon-prices', ['directory-plans']],
  ['payment-fees', ['directory-plans']],
  ['ai-concierge', ['ai-concierge']],
  ['contacts', ['contacts']],
  ['couples', ['couples', 'contacts']],
  ['support', ['support']],
  ['blog', ['blog']],
  ['page-seo', ['seo-pages']],
  ['suggested-articles', ['suggested-articles']],
  ['funnel-ab', ['funnel-ab']],
];

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * May a team member with these tabs make this request? `request` is the
 * proxy's "<METHOD> <path>"; without it nothing is assumed (no change allowed).
 */
export function adminRequestAllowed(request: string | null | undefined, tabs: ReadonlySet<string>): boolean {
  if (!request) return false;
  const [method = '', path = ''] = request.split(' ');
  if (READS.has(method.toUpperCase())) return true;
  if (!path.startsWith('/api/admin/')) return false;
  const section = path.slice('/api/admin/'.length);
  const hit = ADMIN_WRITE_TABS.find(([prefix]) => section === prefix || section.startsWith(`${prefix}/`));
  if (!hit) return false;
  return hit[1].includes('*') || hit[1].some((t) => tabs.has(t));
}
