import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// A Supabase query only runs once it's awaited or `.then` is called, so a
// fire-and-forget `void supabaseAdmin.from(...).insert(...)` never happens at
// all. Until Oct 2 five did nothing: the Zapier "lead created" history, the
// saved-reply use counts and the team's last sign-in time. A fire-and-forget
// query has to end in `.then(...)`.
const SRC = join(__dirname, '..', '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** The statement starting at `from`, up to its `;` at bracket depth 0. */
function statementAt(src: string, from: number): string {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return src.slice(from, i);
  }
  return src.slice(from);
}

describe('fire-and-forget database calls actually run', () => {
  it('every `void <client>.from(...)` / `.rpc(...)` ends in .then or .catch', () => {
    const lazy: string[] = [];
    for (const file of walk(SRC)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/void\s+[A-Za-z_]\w*\s*\.\s*(?:from|rpc)\(/g)) {
        const stmt = statementAt(src, m.index!);
        if (!/\.then\(|\.catch\(/.test(stmt)) {
          lazy.push(`${file.slice(SRC.length + 1)}:${src.slice(0, m.index).split('\n').length}`);
        }
      }
    }
    expect(lazy).toEqual([]);
  });
});
