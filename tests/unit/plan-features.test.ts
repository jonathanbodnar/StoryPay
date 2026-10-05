import { describe, expect, it } from 'vitest';
import { resolveVenueFeatureAccess, VENUE_FEATURE_COLUMNS, type PlanFeatureRow, type VenueFeatureRow } from '@/lib/plan-features';

// Whose couples our concierge team handles. Venue Management's "Venue
// Concierge" box (with Private Client) has always said it sends a venue's
// bride replies to the Support Inbox, but until Oct 5 2026 the inbox only
// looked at the AI Concierge add-on: a Private Client on a plan without it
// (Retreat at Evans Farms) never appeared there.

const BBS: PlanFeatureRow = { slug: 'bride-booking-system', name: 'Bride Booking System', is_legacy: false, feature_flags: {} };
const ALL_IN_AI: PlanFeatureRow = { slug: 'all-inclusive', name: 'All-Inclusive', is_legacy: false, feature_flags: { addon_concierge_included: true } };
const venue = (over: Partial<VenueFeatureRow> = {}): VenueFeatureRow => ({ directory_plan_id: 'plan-1', ...over });
const toSupport = (v: VenueFeatureRow | null, plan: PlanFeatureRow | null = BBS) => resolveVenueFeatureAccess(v, plan).supportHandlesBrideReplies;

describe('whose bride replies go to the Support Inbox', () => {
  it('a Private Client with Venue Concierge checked: always, whatever the plan', () => {
    const client = venue({ is_private_client: true, venue_concierge: true });
    expect(toSupport(client)).toBe(true);
    expect(toSupport(client, { slug: 'free', name: 'Free', is_legacy: false, feature_flags: {} })).toBe(true);
    // It takes both boxes: either one alone leaves the venue handling its own replies.
    expect(toSupport(venue({ is_private_client: true }))).toBe(false);
    expect(toSupport(venue({ venue_concierge: true }))).toBe(false);
    expect(toSupport(venue())).toBe(false);
  });

  it('even with the AI switched off for that venue: the team still handles its couples', () => {
    const client = venue({ is_private_client: true, venue_concierge: true, ai_concierge_admin_disabled: true });
    const access = resolveVenueFeatureAccess(client, ALL_IN_AI);
    expect(access.hasConcierge).toBe(false);
    expect(access.supportHandlesBrideReplies).toBe(true);
  });

  it('and, as before, any venue with the AI Concierge: add-on, plan, or legacy', () => {
    expect(toSupport(venue({ directory_addon_concierge: true }))).toBe(true);
    expect(toSupport(venue(), ALL_IN_AI)).toBe(true);
    expect(toSupport(venue(), { slug: 'legacy', name: 'Legacy', is_legacy: true, feature_flags: {} })).toBe(true);
    expect(toSupport({ directory_plan_id: null }, null)).toBe(true); // no plan at all: grandfathered
    // …unless the AI is switched off for it and it isn't a Private Client with the box.
    expect(toSupport(venue({ directory_addon_concierge: true, ai_concierge_admin_disabled: true }))).toBe(false);
  });

  it('checking the box does not hand the venue the AI Concierge itself', () => {
    const access = resolveVenueFeatureAccess(venue({ is_private_client: true, venue_concierge: true }), BBS);
    expect(access).toMatchObject({ hasConcierge: false, hasSms: false, canMessageConcierge: true, supportHandlesBrideReplies: true });
  });

  it('the Private Client box is read with the rest of a venue’s flags', () => {
    expect(VENUE_FEATURE_COLUMNS.split(', ')).toEqual(expect.arrayContaining(['is_private_client', 'venue_concierge']));
  });
});
