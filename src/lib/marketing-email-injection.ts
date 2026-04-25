import type { MarketingEmailDefinition } from '@/lib/marketing-email-schema';

export type VenueSocial = { platform: string; url: string };

// Platforms supported by both the editor and the renderer. Kept in sync with
// SOCIAL_PLATFORM_DEFS in src/lib/use-brand-socials.ts and the KNOWN set in
// src/app/api/venues/me/route.ts. Anything else (e.g. legacy 'threads' rows
// from before the platform was removed) is dropped at injection time so we
// never ship an empty chip to a recipient.
const SUPPORTED_SOCIAL_PLATFORMS = new Set([
  'facebook', 'instagram', 'youtube', 'tiktok', 'pinterest',
  'linkedin', 'twitter', 'website',
]);

/**
 * Pre-process an email definition before it goes through `renderMarketingEmailHtml`.
 *
 * Today this only handles the `social` block: there is no per-block link list,
 * so we copy the venue's `brand_socials` onto each social block's `socialLinks`
 * field. Unknown / retired platforms are filtered out here so the renderer
 * only sees current platforms. Same pattern can be extended later (e.g.
 * address block already uses merge variables but could be normalized here too).
 *
 * Returns a new definition; never mutates the input.
 */
export function injectVenueDataIntoDefinition(
  definition: MarketingEmailDefinition,
  venueSocials: VenueSocial[] | null | undefined,
): MarketingEmailDefinition {
  const socials = (venueSocials ?? []).filter(
    (s) => s && s.platform && s.url && SUPPORTED_SOCIAL_PLATFORMS.has(s.platform),
  );
  if (definition.blocks.length === 0) return definition;

  const blocks = definition.blocks.map((b) => {
    if (b.type === 'social') {
      return { ...b, socialLinks: socials };
    }
    return b;
  });
  return { ...definition, blocks };
}
