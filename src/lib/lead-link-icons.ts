/**
 * Canonical icon set for the venue's custom Lead Link buttons.
 *
 * Keys are stored in `venues.lead_link_links[].icon` and mapped to a concrete
 * lucide icon in two places that MUST stay in sync with this list:
 *   • the dashboard editor / picker  (src/app/dashboard/listing/lead-link/page.tsx)
 *   • the public Lead Link page      (weddingdirectory: src/app/venue/[slug]/links)
 */
export const LEAD_LINK_ICON_KEYS = [
  // web / links
  'link',
  'globe',
  'link-2',
  'external-link',
  'qr-code',
  'share-2',
  'rss',
  'hash',
  // scheduling
  'calendar',
  'calendar-check',
  'calendar-heart',
  'clock',
  'alarm-clock',
  // contact
  'phone',
  'smartphone',
  'mail',
  'message-circle',
  'message-square',
  'send',
  'at-sign',
  'bell',
  'contact',
  // video / photo
  'video',
  'play',
  'film',
  'clapperboard',
  'camera',
  'image',
  'images',
  'aperture',
  'focus',
  // audio / music
  'music',
  'music-2',
  'mic',
  'headphones',
  'disc',
  'radio',
  'speaker',
  'guitar',
  'piano',
  // reviews / awards
  'star',
  'heart',
  'heart-handshake',
  'thumbs-up',
  'award',
  'badge-check',
  'trophy',
  'medal',
  'crown',
  'gem',
  'diamond',
  'sparkles',
  // location / venue
  'map-pin',
  'map',
  'navigation',
  'compass',
  'home',
  'building',
  'building-2',
  'church',
  'landmark',
  'tent',
  // nature / outdoors
  'tree-palm',
  'trees',
  'mountain',
  'waves',
  'sun',
  'sunset',
  'moon',
  'flower',
  'flower-2',
  'leaf',
  'sprout',
  // food / drink
  'utensils',
  'utensils-crossed',
  'chef-hat',
  'coffee',
  'wine',
  'martini',
  'beer',
  'cup-soda',
  'glass-water',
  'cake',
  'cake-slice',
  'pizza',
  'ice-cream',
  'salad',
  'grape',
  // events
  'gift',
  'party-popper',
  'ticket',
  'tickets',
  // money / commerce
  'dollar-sign',
  'badge-dollar-sign',
  'tag',
  'tags',
  'credit-card',
  'wallet',
  'receipt',
  'percent',
  'shopping-bag',
  'shopping-cart',
  'store',
  'package',
  // docs / info
  'file-text',
  'file',
  'book',
  'book-open',
  'clipboard',
  'clipboard-list',
  'newspaper',
  'info',
  'list',
  'list-checks',
  // people
  'users',
  'user',
  'user-plus',
  'handshake',
  'baby',
  // transport
  'car',
  'plane',
  'bus',
  'ship',
  'anchor',
  'route',
  // spaces / furnishings
  'armchair',
  'bed-double',
  'sofa',
  'lamp',
  // misc
  'zap',
  'flame',
  'key',
  'palette',
  'paintbrush',
  'scissors',
  'feather',
  'snowflake',
  'umbrella',
  'check-check',
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
