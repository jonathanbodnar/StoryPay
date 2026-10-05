import { execFileSync } from 'child_process';
import { describe, expect, it } from 'vitest';

// Lead Finder's own fixture checks (scripts/leadfinder-extract-check.mjs): every
// sample inquiry email must extract the right couple, date, guests and source.
describe('Lead Finder extraction', () => {
  it('passes every fixture', () => {
    const out = execFileSync('node', ['scripts/leadfinder-extract-check.mjs'], { encoding: 'utf8', timeout: 120_000 });
    const m = /(\d+)\/(\d+) checks passed/.exec(out);
    expect(m, out.slice(-500)).not.toBeNull();
    expect(Number(m![2])).toBeGreaterThanOrEqual(95);
    expect(m![1]).toBe(m![2]);
  }, 120_000);
});
