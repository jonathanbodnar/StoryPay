import { describe, expect, it } from 'vitest';
import { zonesForPhone } from '@/lib/phone-timezone';
import { insideTextingHours, nextTextingTime, textingZones } from '@/lib/texting-hours';
import { isSmsOptInKeyword, isSmsOptOutKeyword } from '@/lib/sms-compliance';

const ET = 'America/New_York';
const CT = 'America/Chicago';
const PT = 'America/Los_Angeles';
const at = (iso: string) => new Date(iso);

describe('time zone from the area code', () => {
  it('reads US numbers in any format', () => {
    expect(zonesForPhone('+1 (212) 555-0100')).toEqual([ET]);
    expect(zonesForPhone('212-555-0100')).toEqual([ET]);
    expect(zonesForPhone('13105550100')).toEqual([PT]);
    expect(zonesForPhone('312.555.0100')).toEqual([CT]);
    expect(zonesForPhone('602 555 0100')).toEqual(['America/Phoenix']);
    expect(zonesForPhone('8085550100')).toEqual(['Pacific/Honolulu']);
  });

  it('lists both zones for split area codes', () => {
    expect(zonesForPhone('8505550100')).toEqual([ET, CT]);
    expect(zonesForPhone('2705550100')).toEqual([ET, CT]);
  });

  it('returns nothing for toll-free, short or foreign numbers', () => {
    for (const p of ['8005550100', '555-0100', '+44 20 7946 0958', '', null, undefined]) expect(zonesForPhone(p)).toEqual([]);
  });

  it("falls back to the venue's zone, then Eastern", () => {
    expect(textingZones('8005550100', 'America/Denver')).toEqual(['America/Denver']);
    expect(textingZones(null, null)).toEqual([ET]);
    expect(textingZones('3105550100', 'America/Denver')).toEqual([PT]);
  });
});

describe('9 am to 9 pm in the lead’s own time', () => {
  it('opens at 9:00 and closes at 9:00 pm (October, Eastern daylight time)', () => {
    expect(insideTextingHours(at('2026-10-01T12:59:00Z'), [ET])).toBe(false); // 8:59 am
    expect(insideTextingHours(at('2026-10-01T13:00:00Z'), [ET])).toBe(true);  // 9:00 am
    expect(insideTextingHours(at('2026-10-02T00:59:00Z'), [ET])).toBe(true);  // 8:59 pm
    expect(insideTextingHours(at('2026-10-02T01:00:00Z'), [ET])).toBe(false); // 9:00 pm
  });

  it('uses the lead’s zone, not the server’s', () => {
    expect(insideTextingHours(at('2026-10-01T14:00:00Z'), [PT])).toBe(false); // 7 am in LA
    expect(insideTextingHours(at('2026-10-01T16:00:00Z'), [PT])).toBe(true);  // 9 am in LA
  });

  it('for a split area code, only the hours that are daytime in both', () => {
    expect(insideTextingHours(at('2026-10-01T13:30:00Z'), [ET, CT])).toBe(false); // 9:30 ET, 8:30 CT
    expect(insideTextingHours(at('2026-10-01T14:00:00Z'), [ET, CT])).toBe(true);  // 10:00 ET, 9:00 CT
    expect(insideTextingHours(at('2026-10-02T00:30:00Z'), [ET, CT])).toBe(true);  // 8:30 pm ET
    expect(insideTextingHours(at('2026-10-02T01:00:00Z'), [ET, CT])).toBe(false); // 9:00 pm ET
  });

  it('follows the clock change in November', () => {
    expect(insideTextingHours(at('2026-11-02T13:30:00Z'), [ET])).toBe(false); // 8:30 am EST
    expect(insideTextingHours(at('2026-11-02T14:00:00Z'), [ET])).toBe(true);  // 9:00 am EST
  });

  it('holds a late text until 9 am the next morning', () => {
    expect(nextTextingTime(at('2026-10-02T02:00:00Z'), [ET]).toISOString()).toBe('2026-10-02T13:00:00.000Z');
    expect(nextTextingTime(at('2026-10-01T12:57:00Z'), [ET]).toISOString()).toBe('2026-10-01T13:00:00.000Z');
    expect(nextTextingTime(at('2026-10-02T02:00:00Z'), [ET, CT]).toISOString()).toBe('2026-10-02T14:00:00.000Z');
  });

  it('sends right away inside the window', () => {
    const t = at('2026-10-01T18:17:23Z');
    expect(nextTextingTime(t, [ET])).toBe(t);
  });
});

describe('STOP and START', () => {
  it('treats carrier keywords and plain requests as opt-outs', () => {
    for (const body of [
      'STOP', 'Stop.', 'stop!', 'STOPALL', 'unsubscribe', 'Cancel', 'END', 'quit', 'STOP 🛑',
      'please stop', 'Stop texting me', 'stop texting me please', 'Please remove me from this list',
      'take me off your list', "don't text me", 'Do not contact me again', 'no more texts', 'Opt-out', 'opt out please',
    ]) expect(isSmsOptOutKeyword(body), body).toBe(true);
  });

  it('does not treat ordinary replies as opt-outs', () => {
    for (const body of [
      'End of August 2027 works for us', 'Cancel our tour Saturday, we need to reschedule', "Can't stop smiling about the venue!",
      'Yes', 'Is it ok to text you?', 'We stopped by last week', '', '   ',
    ]) expect(isSmsOptOutKeyword(body), body).toBe(false);
  });

  it('treats START, UNSTOP, YES and SUBSCRIBE as opt-ins, alone', () => {
    for (const body of ['START', 'Start.', 'unstop', 'Yes', 'YES!', 'subscribe', 'start please']) expect(isSmsOptInKeyword(body), body).toBe(true);
    for (const body of ['Yes we would love a tour', 'yes please send pricing', 'Start date is June', 'STOP']) expect(isSmsOptInKeyword(body), body).toBe(false);
  });
});
