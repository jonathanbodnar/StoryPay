/**
 * Canonical list of admin tabs that can be granted/revoked per team member.
 *
 * Keep in sync with AdminTabKey + ADMIN_NAV_ITEMS in
 * src/app/admin/[[...slug]]/layout.tsx. Adding a tab here makes it appear as
 * a checkbox in the admin Team page.
 *
 * The 'team' tab itself is NEVER granted to non-super-admins (it's hardcoded
 * to require is_super_admin=true) so it's intentionally NOT in this list.
 */

export type AdminTabKey =
  | 'dashboard'
  | 'venues'
  | 'couples'
  | 'contacts'
  | 'subscriptions'
  | 'directory-plans'
  | 'directory-badges'
  | 'ai-concierge'
  | 'support'
  | 'canned-replies'
  | 'announcements'
  | 'feature-requests'
  | 'changelog'
  | 'suggested-articles'
  | 'search-analytics'
  | 'article-ratings'
  | 'blog'
  | 'seo-pages'
  | 'trends'
  | 'analytics'
  | 'errors'
  | 'system';

export interface AdminTabDef {
  key: AdminTabKey;
  label: string;
  category: 'core' | 'venue' | 'content' | 'tools';
}

export const ADMIN_TABS: AdminTabDef[] = [
  { key: 'dashboard',          label: 'Dashboard',           category: 'core' },
  { key: 'venues',             label: 'Venue management',    category: 'venue' },
  { key: 'couples',            label: 'Couples',             category: 'venue' },
  { key: 'contacts',           label: 'Contacts',            category: 'venue' },
  { key: 'subscriptions',      label: 'Subscriptions',       category: 'venue' },
  { key: 'directory-badges',   label: 'Verified & Sponsored', category: 'venue' },
  { key: 'directory-plans',    label: 'Directory plans',     category: 'venue' },
  { key: 'ai-concierge',       label: 'AI Concierge',        category: 'venue' },
  { key: 'support',            label: 'Support inbox',       category: 'core' },
  { key: 'canned-replies',     label: 'Saved replies',       category: 'core' },
  { key: 'blog',               label: 'Blog Posts',          category: 'content' },
  { key: 'seo-pages',          label: 'SEO / Pages',         category: 'content' },
  { key: 'trends',             label: 'Google Trends',       category: 'content' },
  { key: 'announcements',      label: 'Announcements',       category: 'content' },
  { key: 'feature-requests',   label: 'Feature Requests',    category: 'content' },
  { key: 'changelog',          label: 'Changelog',           category: 'content' },
  { key: 'suggested-articles', label: 'Suggested Articles',  category: 'content' },
  { key: 'search-analytics',   label: 'Search Analytics',    category: 'content' },
  { key: 'article-ratings',    label: 'Article Ratings',     category: 'content' },
  { key: 'analytics',          label: 'Usage Analytics',     category: 'tools' },
  { key: 'errors',             label: 'Error Log',           category: 'tools' },
  { key: 'system',             label: 'System / Migrations', category: 'tools' },
];

export const ADMIN_TAB_KEY_SET = new Set<string>(ADMIN_TABS.map((t) => t.key));

export const ADMIN_TAB_CATEGORY_LABELS: Record<AdminTabDef['category'], string> = {
  core:    'Core',
  venue:   'Venues & customers',
  content: 'Content & analytics',
  tools:   'Internal tools',
};

/** Default checkboxes for a brand-new team member: all true. */
export function defaultAdminTabsAllTrue(): Record<string, boolean> {
  return Object.fromEntries(ADMIN_TABS.map((t) => [t.key, true]));
}

/** Default checkboxes for a brand-new team member: all false. */
export function defaultAdminTabsAllFalse(): Record<string, boolean> {
  return Object.fromEntries(ADMIN_TABS.map((t) => [t.key, false]));
}

/**
 * Resolve the effective tab access for a member, given their saved
 * admin_tabs_allowed jsonb and is_super_admin flag.
 *
 * - If is_super_admin → all tabs allowed (always).
 * - If admin_tabs_allowed is null/empty → all tabs DENIED (must be granted).
 * - Otherwise → boolean lookup, missing keys = false.
 */
export function resolveAllowedAdminTabs(
  isSuperAdmin: boolean,
  saved: Record<string, boolean> | null | undefined,
): Set<string> {
  if (isSuperAdmin) return new Set(ADMIN_TABS.map((t) => t.key));
  if (!saved || typeof saved !== 'object') return new Set();
  const out = new Set<string>();
  for (const t of ADMIN_TABS) {
    if (saved[t.key] === true) out.add(t.key);
  }
  return out;
}
