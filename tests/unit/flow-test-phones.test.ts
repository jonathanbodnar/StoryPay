import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Flow tests that text make up a couple's phone number from the run's id:
// `(646) 55X-${n}`, where every file in a run gets the same n. The texting
// stand-in knows a couple by her number, so two files using the same 55X give
// two different couples one conversation. Oct 5 2026: a new test reused 557,
// the AI test's number; in a full run the AI never saw its bride's text and
// its hand-off test failed, while passing alone.
describe('flow tests that text', () => {
  it('no two files give their couples the same phone number', () => {
    const dir = join(__dirname, '..', 'flows');
    const users = new Map<string, string[]>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.test.ts'))) {
      const source = readFileSync(join(dir, file), 'utf8');
      // Numbers built from the run: a literal like (212) 555-0188 is one fixed couple.
      const prefixes = new Set([...source.matchAll(/\((\d{3})\) (\d{3})-\$\{/g)].map((m) => `(${m[1]}) ${m[2]}`));
      for (const prefix of prefixes) users.set(prefix, [...(users.get(prefix) ?? []), file]);
    }
    expect(users.size).toBeGreaterThan(5);
    const shared = [...users.entries()].filter(([, files]) => files.length > 1).map(([prefix, files]) => `${prefix}-n: ${files.join(', ')}`);
    expect(shared, 'two flow test files text the same number').toEqual([]);
  });
});
