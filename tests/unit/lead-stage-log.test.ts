import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stageMovedBy, stageMoveLines, stageMoveSentence, type StageLogRow } from '@/lib/lead-stage-log';

// Stage moves in a bride's thread (owner's ask, Oct 5 2026): each time she is
// moved to another pipeline stage, the venue and support see one line: when,
// to which stage, and who moved her. The couple never sees it.

let n = 0;
const log = (to: string, over: Partial<StageLogRow> & { from?: string | null; kind?: string; label?: string; secs?: number } = {}): StageLogRow => {
  const { from = 'Lead', kind, label, secs = 60 * ++n, ...rest } = over;
  return {
    id: `row-${n}-${secs}`, lead_id: 'lead-1', actor_member_id: null, actor_is_owner: false,
    created_at: new Date(Date.parse('2026-10-05T14:00:00Z') + secs * 1000).toISOString(),
    details: {
      to_stage_id: `id-${to}`, to_stage_name: to,
      ...(from ? { from_stage_id: `id-${from}`, from_stage_name: from } : {}),
      ...(kind ? { actor_kind: kind } : {}), ...(label ? { actor_label: label } : {}),
    },
    ...rest,
  };
};
const by = (rows: StageLogRow[], names = {}) => stageMoveLines(rows, names).map((m) => `${m.to} by ${m.by}`);

describe('who moved her', () => {
  it('the name written with the move comes first', () => {
    expect(by([log('Qualified', { kind: 'support', label: 'Francine Euniekrist (StoryVenue Support)' })])).toEqual(['Qualified by Francine Euniekrist (StoryVenue Support)']);
    expect(by([log('Tour Booked', { kind: 'ai', label: 'AI Concierge' })])).toEqual(['Tour Booked by AI Concierge']);
  });

  it('a team member is named from the venue’s team; the owner by name when known', () => {
    const rows = [log('Qualified', { kind: 'team', actor_member_id: 'm1' }), log('Tour Booked', { kind: 'owner', actor_is_owner: true })];
    expect(by(rows, { members: { m1: 'Casey Coordinator' }, owner: 'Jo Ann Wilkerson' })).toEqual(['Qualified by Casey Coordinator', 'Tour Booked by Jo Ann Wilkerson']);
    expect(by(rows)).toEqual(['Qualified by Team member', 'Tour Booked by Owner']);
  });

  it('a move nobody put their name to is an automation', () => {
    expect(by([log('Follow Up')])).toEqual(['Follow Up by Automation']);
    expect(stageMoveLines([log('Follow Up')])[0].byKind).toBe('automation');
  });

  it('older log rows, written before moves said who, still read right', () => {
    expect(by([log('Qualified', { actor_is_owner: true })], { owner: 'Jo Ann Wilkerson' })).toEqual(['Qualified by Jo Ann Wilkerson']);
    expect(by([log('Qualified', { actor_member_id: 'm1' })], { members: { m1: 'Casey Coordinator' } })).toEqual(['Qualified by Casey Coordinator']);
  });
});

describe('what counts as a line', () => {
  it('moves are listed oldest first, with where she came from', () => {
    const lines = stageMoveLines([log('Tour Booked', { from: 'Qualified', secs: 900 }), log('Qualified', { from: 'Lead', secs: 300 })]);
    expect(lines.map((l) => [l.from, l.to])).toEqual([['Lead', 'Qualified'], ['Qualified', 'Tour Booked']]);
    expect(stageMoveSentence({ from: 'Qualified', to: 'Tour Booked', by: 'Jo Ann Wilkerson' })).toBe('Moved from Qualified to Tour Booked by Jo Ann Wilkerson');
    expect(stageMoveSentence({ from: null, to: 'Qualified', by: 'Owner' })).toBe('Moved to Qualified by Owner');
  });

  it('a move written down twice is shown once, keeping the row that names a person', () => {
    // The database logs every move; the route that made it used to log it too.
    const twice = [log('Qualified', { secs: 100 }), log('Qualified', { secs: 101, kind: 'owner', actor_is_owner: true })];
    expect(by(twice, { owner: 'Jo Ann Wilkerson' })).toEqual(['Qualified by Jo Ann Wilkerson']);
    // The same stage again later is another move.
    expect(by([log('Qualified', { secs: 100 }), log('Lead', { from: 'Qualified', secs: 200 }), log('Qualified', { secs: 300 })])).toHaveLength(3);
    // …and so is going straight back to a stage she left seconds ago (an
    // owner, then support, then an automation, within three seconds: the end-to-end test).
    const quick = [
      log('Qualified', { from: 'Conversations Started', secs: 100, kind: 'owner', actor_is_owner: true }),
      log('Tour Booked', { from: 'Qualified', secs: 101, kind: 'support', label: 'StoryVenue Support' }),
      log('Qualified', { from: 'Tour Booked', secs: 103 }),
    ];
    expect(by(quick)).toEqual(['Qualified by Owner', 'Tour Booked by StoryVenue Support', 'Qualified by Automation']);
  });

  it('a new lead being placed in its first stage by the system is not a move; a person placing it is', () => {
    expect(by([log('Lead', { from: null })])).toEqual([]);
    expect(by([log('Lead', { from: null, kind: 'couple', label: 'New inquiry' })])).toEqual([]);
    expect(by([log('Qualified', { from: null, kind: 'owner', actor_is_owner: true })])).toEqual(['Qualified by Owner']);
  });

  it('a row that doesn’t say where she went is left out, and nothing breaks on odd rows', () => {
    const odd = [{ ...log('X'), details: null }, { ...log('X'), details: { to_stage_name: '   ' } }, log('Qualified', { kind: 'martian' })];
    expect(by(odd as StageLogRow[])).toEqual(['Qualified by Automation']);
  });
});

describe('saying who, when a move is made', () => {
  it('each move’s note is new, so the database ties it to that move', async () => {
    const a = stageMovedBy('team', ' Casey Coordinator ', 'm1');
    expect(a).toMatchObject({ kind: 'team', label: 'Casey Coordinator', member_id: 'm1' });
    await new Promise((r) => setTimeout(r, 5));
    expect(stageMovedBy('team', 'Casey Coordinator', 'm1').at).not.toBe(a.at);
    expect(stageMovedBy('owner')).toMatchObject({ kind: 'owner', label: null, member_id: null });
  });
});

describe('the couple never sees stage moves', () => {
  const read = (path: string) => readFileSync(join(__dirname, '..', '..', path), 'utf8');

  it('they are kept in the activity log, never written as messages', () => {
    const lib = read('src/lib/lead-stage-log.ts');
    expect(lib).toContain(".from('lead_activity_log')");
    expect(lib.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/from\('conversation_messages'\)/);
    const migration = read('migrations/280_thread_accountability.sql');
    expect(migration).toContain('INSERT INTO public.lead_activity_log');
    expect(migration).not.toMatch(/INSERT INTO public\.conversation_messages/i);
  });

  it('the couple’s own chat reads messages only, and knows nothing of the log', () => {
    const coupleChat = read('src/app/api/couple/messages/route.ts');
    expect(coupleChat).not.toMatch(/lead_activity_log|lead-stage-log|stage-moves|stageMoves/);
  });
});
