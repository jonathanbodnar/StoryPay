import { describe, expect, it } from 'vitest';
import { normalizeEventTempleName } from '@/lib/eventtemple-names';

// The Event Temple card and the Help Center tell a venue to create a referral
// source named "StoryVenue - Bride Booking System". The label we look for
// carries the trademark sign, so a source created as told was never picked.
describe('matching a name in the venue’s Event Temple account', () => {
  const ours = 'StoryVenue - Bride Booking System\u2122';

  it('the name the venue is told to create matches ours', () => {
    expect(normalizeEventTempleName('StoryVenue - Bride Booking System')).toBe(normalizeEventTempleName(ours));
  });

  it('case and spacing don’t count either', () => {
    expect(normalizeEventTempleName('  storyvenue -  bride booking SYSTEM ')).toBe(normalizeEventTempleName(ours));
    expect(normalizeEventTempleName('wedding')).toBe(normalizeEventTempleName('Wedding'));
  });

  it('a different name still doesn’t match', () => {
    expect(normalizeEventTempleName('StoryVenue')).not.toBe(normalizeEventTempleName(ours));
  });
});
