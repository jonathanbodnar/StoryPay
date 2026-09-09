/**
 * Canonical icon set for the venue's custom Lead Link buttons.
 *
 * Keys are stored in `venues.lead_link_links[].icon` and mapped to a concrete
 * lucide icon in two places that MUST stay in sync with this list:
 *   • the dashboard editor / picker  (src/app/dashboard/listing/lead-link/page.tsx)
 *   • the public Lead Link page      (weddingdirectory: src/app/venue/[slug]/links)
 */
export const LEAD_LINK_ICON_KEYS = [
  'link',
  'calendar',
  'video',
  'play',
  'camera',
  'image',
  'star',
  'heart',
  'gift',
  'music',
  'map-pin',
  'phone',
  'mail',
  'globe',
  'file-text',
  'utensils',
  'ticket',
  'shopping-bag',
  'sparkles',
  'users',
] as const;

export type LeadLinkIconKey = (typeof LEAD_LINK_ICON_KEYS)[number];

export const LEAD_LINK_ICON_KEY_SET: ReadonlySet<string> = new Set(LEAD_LINK_ICON_KEYS);

/** Maximum number of custom links a venue can add to their Lead Link page. */
export const LEAD_LINK_MAX_LINKS = 3;

export type LeadLinkCustomLink = {
  label: string;
  url: string;
  icon: LeadLinkIconKey;
};
