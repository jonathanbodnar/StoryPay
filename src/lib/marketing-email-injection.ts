import type { MarketingEmailDefinition } from '@/lib/marketing-email-schema';

export type VenueSocial = { platform: string; url: string };

/**
 * Pre-process an email definition before it goes through `renderMarketingEmailHtml`.
 *
 * Today this only handles the `social` block: there is no per-block link list,
 * so we copy the venue's `brand_socials` onto each social block's `socialLinks`
 * field. Same pattern can be extended later (e.g. address block already uses
 * merge variables but could be normalized here too).
 *
 * Returns a new definition; never mutates the input.
 */
export function injectVenueDataIntoDefinition(
  definition: MarketingEmailDefinition,
  venueSocials: VenueSocial[] | null | undefined,
): MarketingEmailDefinition {
  const socials = (venueSocials ?? []).filter((s) => s && s.platform && s.url);
  if (definition.blocks.length === 0) return definition;

  const blocks = definition.blocks.map((b) => {
    if (b.type === 'social') {
      return { ...b, socialLinks: socials };
    }
    return b;
  });
  return { ...definition, blocks };
}
