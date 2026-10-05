import { describe, expect, it } from 'vitest';
import { ownRecordOf, SAME_TEXT_WITHIN_MS, sentViaLabel, venueSideTextOrigin, wasNotDelivered, type StoredText } from '@/lib/venue-side-texts';

// Texts the venue side sends from OUTSIDE StoryVenue (a person in the CRM's
// app, a CRM workflow) belong in the bride's thread. Oct 5 2026, White Pine
// Manor: the owner answered a bride four times from her phone, StoryVenue
// imported only the bride's side, and the thread read as her answering
// herself. Across 15 venues' recent threads, 16 texts by people and 3 by CRM
// workflows were missing. These are the rules for bringing them in.

const AT = '2026-10-05T14:51:00.000Z';
const minutesLater = (m: number) => new Date(Date.parse(AT) + m * 60_000).toISOString();
const row = (over: Partial<StoredText> = {}): StoredText => ({ id: 'r1', body: 'Hello', created_at: AT, sender_kind: 'system', ghl_message_id: null, ...over });

describe('who sent a venue-side text', () => {
  it('a person, when the texting account names a user (the owner on her phone)', () => {
    expect(venueSideTextOrigin({ direction: 'outbound', source: 'app', userId: 'u123' })).toEqual({ sentVia: 'crm_user', senderKind: 'owner', userId: 'u123' });
  });

  it('one of the venue’s CRM automations, when its source is a workflow or campaign', () => {
    for (const source of ['workflow', 'Workflow', 'campaign', 'bulk_actions']) {
      expect(venueSideTextOrigin({ source }), source).toEqual({ sentVia: 'crm_workflow', senderKind: 'system', userId: null });
    }
  });

  it('otherwise another app through the CRM (StoryVenue’s own sends look like this too)', () => {
    expect(venueSideTextOrigin({ source: 'app' })).toEqual({ sentVia: 'crm_api', senderKind: 'system', userId: null });
    expect(venueSideTextOrigin({})).toMatchObject({ sentVia: 'crm_api' });
    expect(venueSideTextOrigin({ source: 'app', userId: '  ' })).toMatchObject({ sentVia: 'crm_api' });
  });

  it('a text that never reached the couple is not part of the conversation', () => {
    for (const status of ['failed', 'undelivered', 'Failed']) expect(wasNotDelivered({ status }), status).toBe(true);
    for (const status of ['delivered', 'sent', 'pending', undefined]) expect(wasNotDelivered({ status }), String(status)).toBe(false);
  });
});

describe('StoryVenue’s own sends are never shown twice', () => {
  it('the same words, sent within twenty minutes, are the same text', () => {
    const mine = row({ body: 'Hi Summer! One of the best first steps in planning is having an idea of your guest count.' });
    expect(ownRecordOf('Hi Summer! One of the best first steps in planning is having an idea of your guest count.', minutesLater(1), [mine])).toBe(mine);
    // Spacing and capitals don't matter.
    expect(ownRecordOf('  hi summer!  One of the best first steps in planning is having an idea of your GUEST count. ', AT, [mine])).toBe(mine);
    // The same words an hour later are another text.
    expect(ownRecordOf(mine.body, new Date(Date.parse(AT) + SAME_TEXT_WITHIN_MS + 60_000).toISOString(), [mine])).toBeNull();
  });

  it('a text StoryVenue recorded as a note around it is recognised (the guide text at White Pine Manor)', () => {
    const note = row({ body: '📱 Guide sent via SMS: Hi Summer! I’m White Pine’s assistant. Here is your pricing guide: https://app.storyvenue.com/g/abc' });
    expect(ownRecordOf('Hi Summer! I’m White Pine’s assistant. Here is your pricing guide: https://app.storyvenue.com/g/abc', minutesLater(0.5), [note])).toBe(note);
    // …and when the link was shortened on the way out, by its opening words.
    expect(ownRecordOf('Hi Summer! I’m White Pine’s assistant. Here is your pricing guide: https://sv.link/x1', AT, [note])).toBe(note);
  });

  it('a person’s reply is not mistaken for something StoryVenue sent', () => {
    const stored = [row({ body: 'Hi Summer! One of the best first steps in planning is having an idea of your guest count.' })];
    expect(ownRecordOf('Hi! This is Jo Ann, the owner. I would love to show you around.', minutesLater(2), stored)).toBeNull();
    expect(ownRecordOf('Ok!', AT, [row({ body: 'Ok! I should know by 4 if that works.' })])).toBeNull();
  });

  it('the couple’s texts, and rows that already belong to another CRM text, are never candidates', () => {
    expect(ownRecordOf('Yes!', AT, [row({ body: 'Yes!', sender_kind: 'contact' })])).toBeNull();
    expect(ownRecordOf('Yes!', AT, [row({ body: 'Yes!', ghl_message_id: 'ms_1' })])).toBeNull();
  });

  it('two identical automated texts each find their own record, the nearest in time', () => {
    const first = row({ id: 'a', body: 'Just checking in! Do you have a date in mind for your wedding?', created_at: AT });
    const second = row({ id: 'b', body: 'Just checking in! Do you have a date in mind for your wedding?', created_at: minutesLater(15) });
    expect(ownRecordOf(first.body, minutesLater(14), [first, second])).toBe(second);
    second.ghl_message_id = 'ms_2'; // claimed
    expect(ownRecordOf(first.body, minutesLater(1), [first, second])).toBe(first);
  });

  it('nothing to compare is never a match', () => {
    expect(ownRecordOf('', AT, [row()])).toBeNull();
    expect(ownRecordOf('Hello', AT, [])).toBeNull();
  });
});

describe('what the thread says about it', () => {
  it('to support: who, and that it came from the venue’s own texting', () => {
    expect(sentViaLabel('crm_user', 'Jo Ann Wilkerson')).toBe('Jo Ann Wilkerson · from the venue’s texting app');
    expect(sentViaLabel('crm_user', null)).toBe('Venue · from their texting app');
    expect(sentViaLabel('crm_workflow')).toBe('Automation · venue’s CRM workflow');
    expect(sentViaLabel('crm_api')).toBe('Automated text · sent through the venue’s CRM');
  });

  it('to the venue itself: "your"', () => {
    expect(sentViaLabel('crm_user', 'Jo Ann Wilkerson', 'venue')).toBe('Jo Ann Wilkerson · from your texting app');
    expect(sentViaLabel('crm_user', '', 'venue')).toBe('Sent from your texting app');
    expect(sentViaLabel('crm_workflow', null, 'venue')).toBe('Automation · your CRM workflow');
  });

  it('a message sent through StoryVenue has no such label', () => {
    for (const none of [null, undefined, '', 'something else']) expect(sentViaLabel(none, 'Jo Ann')).toBeNull();
  });
});
