import type { MarketingEmailDefinition } from '@/lib/marketing-email-schema';

export type VenueSocial = { platform: string; url: string };

// Platforms supported by both the editor and the renderer. Kept in sync with
// SOCIAL_PLATFORM_DEFS in src/lib/use-brand-socials.ts and the KNOWN set in
// src/app/api/venues/me/route.ts. Anything else — including legacy rows from
// retired platforms — is dropped at injection time so we never ship an empty
// chip to a recipient.
export const SUPPORTED_SOCIAL_PLATFORMS = new Set([
  'facebook', 'instagram', 'youtube', 'tiktok', 'pinterest',
  'linkedin', 'twitter', 'website',
]);

/**
 * Pre-process an email definition before it goes through `renderMarketingEmailHtml`.
 *
 * Today this only handles the `social` block: there is no per-block link list,
 * so we copy the venue's `brand_socials` onto each social block's `socialLinks`
 * field. Unknown / retired platforms are filtered out here so the renderer
 * only sees current platforms. Each block can also carry a per-block
 * `socialHiddenPlatforms` array — platforms in that list are dropped at
 * injection time so the user can hide a platform from a specific email
 * without removing it from venue branding (Branding → Social Networks stays
 * the registry; the inspector toggle is the per-block override).
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
      const hidden = new Set((b.socialHiddenPlatforms ?? []).filter((p): p is string => typeof p === 'string'));
      const visible = hidden.size === 0
        ? socials
        : socials.filter((s) => !hidden.has(s.platform));
      return { ...b, socialLinks: visible };
    }
    return b;
  });
  return { ...definition, blocks };
}
