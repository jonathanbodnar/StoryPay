import { describe, expect, it } from 'vitest';
import { PAGES } from '../flows/routes';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain data module shared with the screenshot scripts
import { DEVICES, SHOTS, urlFor } from '../../scripts/shots/pages.mjs';

interface Shot { name: string; path: string; who: string; devices?: string[]; fill?: Record<string, string> }

// The screenshot kit (scripts/shots) photographs real screens for marketing
// imagery. If a page it shoots is moved or renamed, this fails the fast
// checks instead of the kit quietly shooting a 404.
describe('screenshot kit', () => {
  it('every shot is a page that exists', () => {
    const missing = (SHOTS as Shot[]).filter((s) => !PAGES.includes(s.path)).map((s) => `${s.name}: ${s.path}`);
    expect(missing).toEqual([]);
  });

  it('every dynamic segment has a fill value and every device exists', () => {
    for (const shot of SHOTS as Shot[]) {
      expect(() => urlFor(shot), shot.name).not.toThrow();
      for (const d of shot.devices ?? []) expect(DEVICES, `${shot.name}: ${d}`).toHaveProperty(d);
      expect(['owner', 'couple', 'visitor'], shot.name).toContain(shot.who);
    }
  });
});
