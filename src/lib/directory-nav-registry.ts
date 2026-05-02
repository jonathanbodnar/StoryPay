/**
 * Canonical dashboard nav entries for directory plans. Each id maps to a URL prefix
 * (longest-prefix wins, except /dashboard which is exact-only for Home).
 */

export type DirectoryNavGroup = 'main' | 'listing' | 'payments' | 'marketing' | 'settings';

export type DirectoryNavRegistryEntry = {
  id: string;
  label: string;
  /** Path prefix; Home uses /dashboard (exact match only in resolver). */
  pathPrefix: string;
  group: DirectoryNavGroup;
};

export const DIRECTORY_NAV_GROUP_LABELS: Record<DirectoryNavGroup, string> = {
  main: 'Main menu',
  listing: 'Venue listing',
  payments: 'Payments & proposals',
  marketing: 'Marketing',
  settings: 'Settings',
};

/** Every dashboard page we enforce; keep in sync with src/app/dashboard routes. */
export const DIRECTORY_NAV_REGISTRY: DirectoryNavRegistryEntry[] = [
  { id: 'nav_main_ai', label: 'Ask AI', pathPrefix: '/dashboard/ai', group: 'main' },
  { id: 'nav_main_home', label: 'Home', pathPrefix: '/dashboard', group: 'main' },
  { id: 'nav_main_contacts', label: 'Contacts', pathPrefix: '/dashboard/contacts', group: 'main' },
  { id: 'nav_main_conversations', label: 'Conversations', pathPrefix: '/dashboard/conversations', group: 'main' },
  { id: 'nav_main_calendar', label: 'Calendar', pathPrefix: '/dashboard/calendar', group: 'main' },
  { id: 'nav_main_leads', label: 'Leads', pathPrefix: '/dashboard/leads', group: 'main' },
  { id: 'nav_main_reports', label: 'Reports', pathPrefix: '/dashboard/reports', group: 'main' },
  { id: 'nav_main_updates', label: "What's New", pathPrefix: '/dashboard/updates', group: 'main' },
  { id: 'nav_main_help', label: 'Help Center', pathPrefix: '/dashboard/help', group: 'main' },
  { id: 'nav_main_media', label: 'Media', pathPrefix: '/dashboard/media', group: 'main' },
  { id: 'nav_main_profile', label: 'Profile', pathPrefix: '/dashboard/profile', group: 'main' },
  { id: 'nav_main_products', label: 'Products', pathPrefix: '/dashboard/products', group: 'main' },
  { id: 'nav_main_sms', label: 'SMS', pathPrefix: '/dashboard/sms', group: 'main' },
  { id: 'nav_main_support', label: 'Support', pathPrefix: '/dashboard/support', group: 'main' },

  { id: 'nav_listing_dashboard', label: 'Listing — Dashboard', pathPrefix: '/dashboard/listing', group: 'listing' },
  { id: 'nav_listing_pricing_guide', label: 'Listing — Pricing Guide', pathPrefix: '/dashboard/listing/pricing-guide', group: 'listing' },
  { id: 'nav_listing_media', label: 'Listing — Media library', pathPrefix: '/dashboard/listing/media', group: 'listing' },
  { id: 'nav_listing_images', label: 'Listing — Images (legacy)', pathPrefix: '/dashboard/listing/images', group: 'listing' },
  { id: 'nav_listing_analytics', label: 'Listing — Analytics', pathPrefix: '/dashboard/listing/analytics', group: 'listing' },
  { id: 'nav_listing_reviews', label: 'Listing — Reviews', pathPrefix: '/dashboard/listing/reviews', group: 'listing' },
  { id: 'nav_listing_directory', label: 'Listing — Verified & Sponsored', pathPrefix: '/dashboard/listing/directory', group: 'listing' },
  { id: 'nav_listing_directory_billing', label: 'Plans & billing', pathPrefix: '/dashboard/directory-billing', group: 'listing' },

  { id: 'nav_payments_new', label: 'Payments — New', pathPrefix: '/dashboard/payments/new', group: 'payments' },
  { id: 'nav_offerings', label: 'Packages — Items & bundles', pathPrefix: '/dashboard/offerings', group: 'payments' },
  { id: 'nav_payments_coupons', label: 'Payments — Coupons', pathPrefix: '/dashboard/payments/coupons', group: 'payments' },
  { id: 'nav_payments_proposals', label: 'Payments — Proposals', pathPrefix: '/dashboard/payments/proposals', group: 'payments' },
  { id: 'nav_payments_installments', label: 'Payments — Installments', pathPrefix: '/dashboard/payments/installments', group: 'payments' },
  { id: 'nav_payments_subscriptions', label: 'Payments — Subscriptions', pathPrefix: '/dashboard/payments/subscriptions', group: 'payments' },
  { id: 'nav_payments_invoices', label: 'Payments — Invoices', pathPrefix: '/dashboard/payments/invoices', group: 'payments' },
  { id: 'nav_payments_payment_links', label: 'Payments — Payment links', pathPrefix: '/dashboard/payments/payment-links', group: 'payments' },
  { id: 'nav_payments_payouts', label: 'Payments — Payouts', pathPrefix: '/dashboard/payments/payouts', group: 'payments' },
  { id: 'nav_proposals_hub', label: 'Proposals — Hub', pathPrefix: '/dashboard/proposals', group: 'payments' },
  { id: 'nav_invoices_new', label: 'Invoices — New', pathPrefix: '/dashboard/invoices/new', group: 'payments' },
  { id: 'nav_transactions', label: 'Transactions', pathPrefix: '/dashboard/transactions', group: 'payments' },
  { id: 'nav_payments_accounting', label: 'Payments — Accounting export', pathPrefix: '/dashboard/payments/accounting', group: 'payments' },

  { id: 'nav_marketing_hub', label: 'Marketing — Overview', pathPrefix: '/dashboard/marketing', group: 'marketing' },
  { id: 'nav_marketing_analytics', label: 'Marketing — Analytics', pathPrefix: '/dashboard/marketing/analytics', group: 'marketing' },
  { id: 'nav_marketing_form_builder', label: 'Marketing — Lead capture forms', pathPrefix: '/dashboard/marketing/form-builder', group: 'marketing' },
  { id: 'nav_marketing_email_templates', label: 'Marketing — Email templates', pathPrefix: '/dashboard/marketing/email/templates', group: 'marketing' },
  { id: 'nav_marketing_email_preferences', label: 'Marketing — Email opt-in / unsubscribes', pathPrefix: '/dashboard/marketing/email/preferences', group: 'marketing' },
  { id: 'nav_marketing_email_campaigns', label: 'Marketing — Email campaigns', pathPrefix: '/dashboard/marketing/email/campaigns', group: 'marketing' },
  { id: 'nav_marketing_email_segments', label: 'Marketing — Audiences', pathPrefix: '/dashboard/marketing/email/audiences', group: 'marketing' },
  { id: 'nav_marketing_email_automations', label: 'Marketing — Workflows', pathPrefix: '/dashboard/marketing/workflows', group: 'marketing' },
  { id: 'nav_marketing_email_root', label: 'Marketing — Email (index)', pathPrefix: '/dashboard/marketing/email', group: 'marketing' },
  { id: 'nav_marketing_trigger_links', label: 'Marketing — Trigger links & tags', pathPrefix: '/dashboard/marketing/trigger-links', group: 'marketing' },

  { id: 'nav_settings_general', label: 'Settings — General', pathPrefix: '/dashboard/settings', group: 'settings' },
  { id: 'nav_settings_branding', label: 'Settings — Branding', pathPrefix: '/dashboard/settings/branding', group: 'settings' },
  { id: 'nav_settings_email_templates', label: 'Settings — Email templates', pathPrefix: '/dashboard/settings/email-templates', group: 'settings' },
  { id: 'nav_settings_integrations', label: 'Settings — Integrations', pathPrefix: '/dashboard/settings/integrations', group: 'settings' },
  { id: 'nav_settings_team', label: 'Settings — Team', pathPrefix: '/dashboard/settings/team', group: 'settings' },
  { id: 'nav_settings_notifications', label: 'Settings — Notifications', pathPrefix: '/dashboard/settings/notifications', group: 'settings' },
];

const NAV_IDS = DIRECTORY_NAV_REGISTRY.map((e) => e.id);

export function allDirectoryNavIds(): string[] {
  return [...NAV_IDS];
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === '/') return '/dashboard';
  const n = pathname.replace(/\/$/, '');
  return n || '/dashboard';
}

/** Longest matching nav id for a pathname, or null if none (unknown route). */
export function resolveNavIdForPath(pathname: string): string | null {
  const n = normalizePath(pathname);
  let best: { id: string; len: number } | null = null;

  for (const e of DIRECTORY_NAV_REGISTRY) {
    const p = e.pathPrefix.replace(/\/$/, '') || e.pathPrefix;
    let ok = false;
    if (p === '/dashboard') {
      ok = n === '/dashboard';
    } else if (n === p) {
      ok = true;
    } else {
      ok = n.startsWith(`${p}/`);
    }
    if (ok && (!best || p.length > best.len)) {
      best = { id: e.id, len: p.length };
    }
  }
  return best?.id ?? null;
}

/** Default map: every nav id allowed (for new plans / tests). */
export function defaultNavPermissionsAllTrue(): Record<string, boolean> {
  return Object.fromEntries(NAV_IDS.map((id) => [id, true]));
}

/** Legacy `feature_flags` keys from directory_feature_definitions → nav ids. */
export const DIRECTORY_LEGACY_FEATURE_TO_NAV_IDS: Record<string, string[]> = {
  ai_assistant: ['nav_main_ai'],
  dashboard_home: ['nav_main_home'],
  contacts: ['nav_main_contacts'],
  leads: ['nav_main_leads'],
  calendar: ['nav_main_calendar'],
  conversations: ['nav_main_conversations'],
  reports: ['nav_main_reports'],
  payments: NAV_IDS.filter((id) => id.startsWith('nav_payments_') || id.startsWith('nav_proposals_') || id === 'nav_transactions' || id === 'nav_invoices_new'),
  marketing: NAV_IDS.filter((id) => id.startsWith('nav_marketing_')),
  listing: NAV_IDS.filter((id) => id.startsWith('nav_listing_')),
  settings: NAV_IDS.filter((id) => id.startsWith('nav_settings_')),
  /** Extras often bundled with “full” product access */
  help_center: ['nav_main_help'],
  whats_new: ['nav_main_updates'],
  profile: ['nav_main_profile'],
  products: ['nav_main_products'],
  sms: ['nav_main_sms'],
  support: ['nav_main_support'],
};

/** Expand legacy directory feature_flags into nav ids (union of allowed routes). */
export function navIdsFromLegacyFeatureFlags(featureFlags: Record<string, boolean> | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!featureFlags || typeof featureFlags !== 'object') return out;
  for (const [key, on] of Object.entries(featureFlags)) {
    if (on !== true) continue;
    const ids = DIRECTORY_LEGACY_FEATURE_TO_NAV_IDS[key];
    if (ids) for (const id of ids) out.add(id);
  }
  return out;
}

/** Coarse feature_flags derived from nav permissions (for backward compatibility). */
export function coarseFeatureFlagsFromNavPermissions(nav: Record<string, boolean>): Record<string, boolean> {
  const get = (id: string) => nav[id] === true;
  const anyPrefix = (prefix: string) => NAV_IDS.some((id) => id.startsWith(prefix) && nav[id] === true);

  return {
    ai_assistant: get('nav_main_ai'),
    dashboard_home: get('nav_main_home'),
    contacts: get('nav_main_contacts'),
    leads: get('nav_main_leads'),
    calendar: get('nav_main_calendar'),
    conversations: get('nav_main_conversations'),
    reports: get('nav_main_reports'),
    payments: NAV_IDS.some(
      (id) =>
        nav[id] === true &&
        (id.startsWith('nav_payments_') || id.startsWith('nav_proposals_') || id === 'nav_transactions' || id === 'nav_invoices_new'),
    ),
    marketing: anyPrefix('nav_marketing_'),
    listing: anyPrefix('nav_listing_'),
    settings: anyPrefix('nav_settings_'),
  };
}
