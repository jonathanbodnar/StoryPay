import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The Zapier app (zapier-app/) calls the public API (/api/v1). Every address it
// calls has to exist in the app, with the method it uses; a renamed or removed
// route would break every venue's Zaps without anything else noticing.
const ROOT = join(__dirname, '..', '..');
const ZAPIER = join(ROOT, 'zapier-app');

function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'build') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Every request in the Zapier app: its method and its /api/v1 path. */
const calls = sources(ZAPIER).flatMap((file) => {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/url:\s*[`'"][^`'"]*?(\/api\/v1\/[^`'"?]*)[^`'"]*[`'"]([^}]{0,200})/g)].map((m) => ({
    file: file.slice(ZAPIER.length + 1),
    path: m[1].replace(/\$\{[^}]+\}/g, '[id]').replace(/\/$/, ''),
    method: m[2].match(/method:\s*'([A-Z]+)'/)?.[1] ?? 'GET',
  }));
});

describe('the Zapier app calls only routes that exist', () => {
  it('finds its requests', () => {
    expect(calls.length).toBeGreaterThan(10);
  });

  it.each(calls.map((c) => [`${c.method} ${c.path} (${c.file})`, c] as const))('%s', (_label, c) => {
    const route = join(ROOT, 'src', 'app', c.path.replace(/^\//, ''), 'route.ts');
    expect(existsSync(route), `${route} is missing`).toBe(true);
    expect(readFileSync(route, 'utf8')).toMatch(new RegExp(`export (async )?function ${c.method}\\b|export const ${c.method}\\b`));
  });
});
